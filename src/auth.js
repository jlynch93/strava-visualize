import { appError, cookie, json, parseCookies, redirect } from "./http.js";
import { hasEncryptionKey } from "./crypto.js";
import {
  createUser,
  deleteConnection,
  deleteUser,
  findConnectionByProviderUser,
  getConnectionTokens,
  getUser,
  listConnections,
  saveConnectionTokens,
  upsertConnection
} from "./db.js";
import { createSession, currentUserId, destroySession } from "./session.js";
import { getProvider, providers } from "./providers/index.js";

const STATE_COOKIE = "sv_oauth_state";

// Problems that stop any sign-in, independent of which provider is chosen.
function platformError(env) {
  if (!env.DB) return "Bind a D1 database as DB to this Worker (see README).";
  if (!hasEncryptionKey(env)) return "Add TOKEN_ENCRYPTION_KEY (32 random bytes, base64) to this Worker.";
  return null;
}

function providerStatus(env, request) {
  const platform = platformError(env);
  return Object.values(providers).map((provider) => {
    const config = provider.config(env, request);
    return {
      id: provider.id,
      name: provider.name,
      configured: !platform && !config.error,
      redirectUri: config.redirectUri,
      error: platform || config.error || null
    };
  });
}

export async function requireUser(env, request) {
  const userId = await currentUserId(env, request);
  if (!userId) throw appError("Sign in first.", 401);
  return userId;
}

export async function handleStatus(env, request) {
  const providerList = providerStatus(env, request);
  const userId = await currentUserId(env, request);
  const connections = userId ? await listConnections(env, userId) : [];
  const configured = providerList.some((provider) => provider.configured);
  return json({
    configured,
    signedIn: Boolean(userId),
    connected: connections.length > 0,
    providers: providerList,
    error: configured ? null : providerList[0]?.error || "No activity provider is configured."
  });
}

export async function handleMe(env, request) {
  const userId = await requireUser(env, request);
  const user = await getUser(env, userId);
  if (!user) throw appError("Sign in first.", 401);
  const connections = await listConnections(env, userId);
  return json({
    user: { id: user.id, displayName: user.display_name, avatarUrl: user.avatar_url, createdAt: user.created_at },
    connections: connections.map((connection) => ({
      provider: connection.provider,
      displayName: connection.display_name,
      connectedAt: connection.created_at
    }))
  });
}

export async function handleDeleteAccount(env, request) {
  const userId = await requireUser(env, request);
  await deleteUser(env, userId);
  return json({ deleted: true }, 200, { "set-cookie": cookie("sv_session", "", 0, request) });
}

export async function handleDisconnect(env, request, providerId) {
  const userId = await requireUser(env, request);
  const connections = await listConnections(env, userId);
  if (!connections.some((connection) => connection.provider === providerId)) {
    return json({ error: "That provider is not connected." }, 404);
  }
  if (connections.length === 1) {
    return json({ error: "This is the only way you sign in. Connect another provider or delete your account instead." }, 409);
  }
  await deleteConnection(env, userId, providerId);
  return json({ disconnected: providerId });
}

export function handleLogin(env, request, providerId) {
  const provider = getProvider(providerId);
  if (!provider) return json({ error: "Unknown provider." }, 404);
  const platform = platformError(env);
  const config = provider.config(env, request);
  if (platform || config.error) return json({ error: platform || config.error }, 503);
  const state = crypto.randomUUID();
  return new Response(null, {
    status: 302,
    headers: {
      location: provider.authorizeUrl(config, state),
      "cache-control": "no-store",
      "set-cookie": cookie(STATE_COOKIE, `${provider.id}.${state}`, 600, request)
    }
  });
}

function authFailure(request, code) {
  return redirect(`/?auth_error=${code}`, [cookie(STATE_COOKIE, "", 0, request)]);
}

export async function handleCallback(env, request, providerId) {
  const provider = getProvider(providerId);
  if (!provider) return json({ error: "Unknown provider." }, 404);
  const platform = platformError(env);
  const config = provider.config(env, request);
  if (platform || config.error) return json({ error: platform || config.error }, 503);

  const url = new URL(request.url);
  const returnedState = url.searchParams.get("state");
  // The state cookie binds this callback to the browser that started sign-in
  // and to the provider it was started for.
  if (!returnedState || parseCookies(request)[STATE_COOKIE] !== `${provider.id}.${returnedState}`) {
    return authFailure(request, "expired");
  }
  if (url.searchParams.get("error")) return authFailure(request, "denied");
  const code = url.searchParams.get("code");
  if (!code) return authFailure(request, "denied");

  const { tokens, account } = await provider.exchangeCode(config, { code, searchParams: url.searchParams });
  const signedInUserId = await currentUserId(env, request);
  const existing = await findConnectionByProviderUser(env, provider.id, account.id);
  const cookies = [cookie(STATE_COOKIE, "", 0, request)];

  if (signedInUserId) {
    if (existing && existing.user_id !== signedInUserId) return authFailure(request, "already_linked");
    await upsertConnection(env, signedInUserId, provider.id, account, tokens);
    return redirect(`/?connected=${provider.id}`, cookies);
  }

  const userId = existing?.user_id || await createUser(env, account);
  await upsertConnection(env, userId, provider.id, account, tokens);
  cookies.push(await createSession(env, userId, request));
  return redirect(`/?signedin=${provider.id}`, cookies);
}

export async function handleLogout(env, request) {
  const sessionCookie = await destroySession(env, request);
  return redirect("/?signedout=1", [sessionCookie, cookie(STATE_COOKIE, "", 0, request)]);
}

// Returns a usable access token for the user's connection, refreshing and
// persisting it when it is within a minute of expiry.
export async function providerAccessToken(env, request, userId, providerId) {
  const provider = getProvider(providerId);
  if (!provider) throw appError("Unknown provider.", 404);
  const config = provider.config(env, request);
  if (config.error) throw appError(config.error, 503);
  const tokens = await getConnectionTokens(env, userId, provider.id);
  if (!tokens) throw appError(`Connect ${provider.name} first.`, 401);
  if (tokens.accessToken && tokens.expiresAt - 60 > Math.floor(Date.now() / 1000)) return tokens.accessToken;
  if (!tokens.refreshToken) throw appError(`Reconnect ${provider.name} to continue.`, 401);
  let refreshed;
  try {
    refreshed = await provider.refresh(config, tokens);
  } catch (error) {
    if (error.status === 401) throw appError(`${provider.name} access was revoked. Reconnect ${provider.name}.`, 401);
    throw error;
  }
  await saveConnectionTokens(env, userId, provider.id, { ...refreshed, refreshToken: refreshed.refreshToken || tokens.refreshToken });
  return refreshed.accessToken;
}
