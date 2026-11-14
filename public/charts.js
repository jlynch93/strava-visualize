/*
 * Shared chart primitives. Every chart here:
 * - measures its container, so it fills the panel at any width;
 * - uses one y-axis with round tick values;
 * - builds its legend from the same series definitions as its marks;
 * - shows a tooltip on hover and on keyboard focus.
 * Depends on svg(), attachTooltip(), showTooltip(), hideTooltip(), tooltipContent(),
 * escapeHtml() and renderEmpty() from script.js, resolved at call time.
 */

// kind: "decimal" (1, 2, 2.5, 5), "integer" (no fractional steps), or "time"
// (seconds: 5, 10, 15, 20, 30 s, then whole minutes).
function niceTicks(min, max, count = 4, kind = "decimal") {
  if (!(max > min)) max = min + 1;
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const candidates = kind === "time" ? [1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600]
    : [1, 2, kind === "integer" && magnitude < 10 ? null : 2.5, 5, 10].filter(Boolean).map((factor) => factor * magnitude);
  const step = candidates.find((value) => value >= raw && (kind !== "integer" || Number.isInteger(value))) || Math.ceil(raw);
  const ticks = [];
  for (let value = Math.floor(min / step) * step; value <= max + step * 0.001; value += step) ticks.push(Number(value.toFixed(6)));
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toFixed(6)));
  return ticks;
}

// Ticks rounded in display units (km, /km) while data stays in internal units.
function scaledTicks(min, max, count, scale = 1, kind = "decimal") {
  return niceTicks(min * scale, max * scale, count, kind).map((tick) => tick / scale);
}

function shortDate(date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function chartSize(container, fallbackHeight) {
  return {
    width: Math.max(container.clientWidth || 0, 280),
    height: Math.max(container.clientHeight || 0, fallbackHeight)
  };
}

function legendMarkup(items) {
  return `<div class="chart-legend">${items.map((item) => `<span class="legend-item"><i class="key ${item.key}"></i>${escapeHtml(item.label)}</span>`).join("")}</div>`;
}

// Place (or replace) a legend directly above a chart container.
function setLegend(container, items) {
  let legend = container.previousElementSibling?.classList.contains("chart-legend-row") ? container.previousElementSibling : null;
  if (!items.length) { legend?.remove(); return; }
  if (!legend) { legend = document.createElement("div"); legend.className = "chart-legend-row"; container.before(legend); }
  legend.innerHTML = legendMarkup(items);
}

// Rounded data end, square at the baseline.
function columnPath(left, top, width, bottom, radius = 4) {
  const r = Math.max(0, Math.min(radius, width / 2, bottom - top));
  return `M${left},${bottom}V${top + r}Q${left},${top} ${left + r},${top}H${left + width - r}Q${left + width},${top} ${left + width},${top + r}V${bottom}Z`;
}

/*
 * Time chart with one y-axis. Lines share a crosshair tooltip; bars are drawn
 * from zero. Hover or focus the chart and use arrow keys to move between days.
 */
function timeChart(container, { dates, series, yFormat, yMin, yMax, bands = [], tooltip, ariaLabel, height, zeroLine = false, endLabels = true, rightPad, yScale = 1 }) {
  if (!dates.length || !series.some((item) => item.values.some((value) => Number.isFinite(value)))) {
    renderEmpty(container, "Not enough data in this window yet.");
    return;
  }
  const { width, height: measured } = chartSize(container, 200);
  const chartHeight = height || measured;
  const hasEndLabels = endLabels && series.some((item) => item.kind !== "bars" && item.kind !== "dots");
  const pad = { top: 14, right: rightPad ?? (hasEndLabels ? 72 : 14), bottom: 26, left: 46 };
  const all = series.flatMap((item) => item.values.filter(Number.isFinite));
  let low = yMin ?? Math.min(...all, ...bands.map((band) => band.from).filter(Number.isFinite));
  let high = yMax ?? Math.max(...all);
  if (yMin === undefined) low = Math.min(low, high) - (high - low) * 0.08;
  if (yMax === undefined) high = high + (high - low) * 0.08;
  const ticks = scaledTicks(low, high, 4, yScale);
  low = ticks[0]; high = ticks[ticks.length - 1];
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = chartHeight - pad.top - pad.bottom;
  const step = dates.length > 1 ? innerWidth / (dates.length - 1) : 0;
  const x = (index) => pad.left + (dates.length > 1 ? index * step : innerWidth / 2);
  const y = (value) => pad.top + innerHeight - (value - low) / (high - low || 1) * innerHeight;
  const root = svg("svg", { viewBox: `0 0 ${width} ${chartHeight}`, role: "img", tabindex: "0", "aria-label": ariaLabel, class: "time-chart" });
  bands.forEach((band) => {
    const top = y(Math.min(high, band.to)), bottom = y(Math.max(low, band.from));
    if (bottom - top <= 0) return;
    root.append(svg("rect", { class: `band ${band.className}`, x: pad.left, y: top, width: innerWidth, height: bottom - top }));
    if (band.label && bottom - top > 14) root.append(svg("text", { class: "band-label", x: pad.left + 6, y: top + 12 }, [document.createTextNode(band.label)]));
  });
  ticks.forEach((tick) => {
    root.append(svg("line", { class: "axis", x1: pad.left, x2: width - pad.right, y1: y(tick), y2: y(tick) }));
    root.append(svg("text", { class: "label", x: pad.left - 8, y: y(tick) + 4, "text-anchor": "end" }, [document.createTextNode(yFormat(tick))]));
  });
  if (zeroLine && low < 0 && high > 0) root.append(svg("line", { class: "zero-line", x1: pad.left, x2: width - pad.right, y1: y(0), y2: y(0) }));
  const labelEvery = Math.max(1, Math.ceil(dates.length / Math.max(2, Math.floor(innerWidth / 90))));
  dates.forEach((date, index) => {
    if (index % labelEvery === 0) root.append(svg("text", { class: "label", x: x(index), y: chartHeight - 6, "text-anchor": index === 0 ? "start" : "middle" }, [document.createTextNode(shortDate(date))]));
  });
  series.forEach((item) => {
    if (item.kind === "bars") {
      const barWidth = Math.max(1, Math.min(10, step * 0.7));
      item.values.forEach((value, index) => {
        if (!Number.isFinite(value) || !value) return;
        const top = y(Math.max(0, value)), bottom = y(Math.min(0, value));
        root.append(svg("rect", { class: `series-bar ${typeof item.className === "function" ? item.className(value) : item.className}`, x: x(index) - barWidth / 2, y: top, width: barWidth, height: Math.max(1, bottom - top), "pointer-events": "none" }));
      });
      return;
    }
    if (item.kind === "dots") {
      item.values.forEach((value, index) => {
        if (Number.isFinite(value)) root.append(svg("circle", { class: `series-dot ${item.className}`, cx: x(index), cy: y(value), r: 2.5, "pointer-events": "none" }));
      });
      return;
    }
    let path = "", pen = false;
    item.values.forEach((value, index) => {
      if (!Number.isFinite(value)) { pen = false; return; }
      path += `${pen ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`; pen = true;
    });
    root.append(svg("path", { class: `series-line ${item.className}`, d: path, "pointer-events": "none" }));
    const lastIndex = item.values.findLastIndex(Number.isFinite);
    if (lastIndex >= 0) {
      root.append(svg("circle", { class: `series-end ${item.className}`, cx: x(lastIndex), cy: y(item.values[lastIndex]), r: 4, "pointer-events": "none" }));
      if (hasEndLabels) item.labelY = y(item.values[lastIndex]);
      item.lastIndex = lastIndex;
    }
  });
  // End labels: value at the line end, nudged apart only when they would overlap.
  if (hasEndLabels) {
    const labelled = series.filter((item) => item.labelY !== undefined && item.kind !== "bars" && item.kind !== "dots").sort((a, b) => a.labelY - b.labelY);
    labelled.forEach((item, index) => {
      if (index && item.labelY - labelled[index - 1].labelY < 26) item.labelY = labelled[index - 1].labelY + 26;
      root.append(
        svg("text", { class: "end-label", x: width - pad.right + 10, y: item.labelY }, [document.createTextNode(yFormat(item.values[item.lastIndex]))]),
        svg("text", { class: "end-name", x: width - pad.right + 10, y: item.labelY + 12 }, [document.createTextNode(item.short || item.label)])
      );
    });
  }
  const guide = svg("line", { class: "crosshair", y1: pad.top, y2: pad.top + innerHeight, x1: 0, x2: 0, visibility: "hidden" });
  const focusDots = series.filter((item) => item.kind !== "bars" && item.kind !== "dots").map((item) => ({ item, dot: svg("circle", { class: `series-end ${item.className}`, r: 4.5, visibility: "hidden", "pointer-events": "none" }) }));
  root.append(guide, ...focusDots.map((entry) => entry.dot));
  const overlay = svg("rect", { class: "hit-area", x: pad.left, y: pad.top, width: innerWidth, height: innerHeight, fill: "transparent" });
  root.append(overlay);
  let active = dates.length - 1;
  const show = (index, event) => {
    active = Math.max(0, Math.min(dates.length - 1, index));
    const px = x(active);
    guide.setAttribute("x1", px); guide.setAttribute("x2", px); guide.setAttribute("visibility", "visible");
    focusDots.forEach(({ item, dot }) => {
      const value = item.values[active];
      dot.setAttribute("visibility", Number.isFinite(value) ? "visible" : "hidden");
      if (Number.isFinite(value)) { dot.setAttribute("cx", px); dot.setAttribute("cy", y(value)); }
    });
    const content = tooltip(active);
    const box = root.getBoundingClientRect();
    const scale = box.width / width || 1;
    showTooltip(tooltipContent(content.title, content.rows), event || { clientX: box.left + px * scale, clientY: box.top + pad.top * scale }, root);
  };
  const hide = () => { guide.setAttribute("visibility", "hidden"); focusDots.forEach(({ dot }) => dot.setAttribute("visibility", "hidden")); hideTooltip(); };
  overlay.addEventListener("pointermove", (event) => {
    const box = root.getBoundingClientRect();
    const px = (event.clientX - box.left) * (width / box.width);
    show(Math.round((px - pad.left) / (step || 1)), event);
  });
  overlay.addEventListener("pointerleave", hide);
  root.addEventListener("focus", () => show(active));
  root.addEventListener("blur", hide);
  root.addEventListener("keydown", (event) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity, PageUp: -7, PageDown: 7 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    show(Number.isFinite(moves[event.key]) ? active + moves[event.key] : moves[event.key] < 0 ? 0 : dates.length - 1);
  });
  container.replaceChildren(root);
}

/*
 * Column chart over ordered periods, optionally stacked. Each column is one
 * focusable mark with a tooltip; `action(index)` makes it open the period's runs.
 */
function columnChart(container, { periods, series, yFormat, tooltip, action, inProgress = [], ariaLabel, height, yScale = 1 }) {
  const totals = periods.map((_, index) => series.reduce((sum, item) => sum + (Number(item.values[index]) || 0), 0));
  if (!periods.length || !totals.some((value) => value > 0)) { renderEmpty(container); return; }
  const { width, height: measured } = chartSize(container, 200);
  const chartHeight = height || measured;
  const pad = { top: 16, right: 10, bottom: 26, left: 46 };
  const ticks = scaledTicks(0, Math.max(...totals), 4, yScale);
  const high = ticks[ticks.length - 1];
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = chartHeight - pad.top - pad.bottom;
  const slot = innerWidth / periods.length;
  const barWidth = Math.max(3, Math.min(28, slot * 0.6));
  const y = (value) => pad.top + innerHeight - value / high * innerHeight;
  const root = svg("svg", { viewBox: `0 0 ${width} ${chartHeight}`, role: "group", "aria-label": ariaLabel });
  ticks.forEach((tick) => {
    root.append(svg("line", { class: "axis", x1: pad.left, x2: width - pad.right, y1: y(tick), y2: y(tick) }));
    root.append(svg("text", { class: "label", x: pad.left - 8, y: y(tick) + 4, "text-anchor": "end" }, [document.createTextNode(yFormat(tick))]));
  });
  const labelEvery = Math.max(1, Math.ceil(periods.length / Math.max(2, Math.floor(innerWidth / 80))));
  periods.forEach((period, index) => {
    const center = pad.left + slot * index + slot / 2;
    const group = svg("g", { class: `column${inProgress[index] ? " in-progress" : ""}` });
    let base = 0;
    const visible = series.filter((item) => Number(item.values[index]) > 0);
    visible.forEach((item, layer) => {
      const value = Number(item.values[index]);
      const bottom = y(base), top = y(base + value);
      // A 2px surface gap separates stacked segments; only the top segment is rounded.
      const gap = layer > 0 ? 2 : 0;
      const isTop = layer === visible.length - 1;
      group.append(isTop
        ? svg("path", { class: `column-segment ${item.className}`, d: columnPath(center - barWidth / 2, top, barWidth, bottom - gap) })
        : svg("rect", { class: `column-segment ${item.className}`, x: center - barWidth / 2, y: top, width: barWidth, height: Math.max(0, bottom - top - gap) }));
      base += value;
    });
    // Invisible full-height hit target, larger than the mark.
    const hit = svg("rect", { class: "column-hit", x: pad.left + slot * index, y: pad.top, width: slot, height: innerHeight, fill: "transparent" });
    group.append(hit);
    const content = tooltip(index);
    attachTooltip(hit, content.title, content.rows);
    const target = action?.(index);
    if (target?.runs?.length) attachChartAction(hit, target.title, target.runs);
    root.append(group);
    if (index % labelEvery === 0) root.append(svg("text", { class: "label", x: center, y: chartHeight - 6, "text-anchor": "middle" }, [document.createTextNode(period.label)]));
  });
  container.replaceChildren(root);
}

/* Scatter with round ticks on both axes. Points may open a run on click/Enter. */
function scatterChart(container, { points, xFormat, yFormat, xTitle, yTitle, invertY = false, ariaLabel, height, xScale = 1, yScale = 1, yKind = "decimal" }) {
  if (!points.length) { renderEmpty(container); return; }
  const { width, height: measured } = chartSize(container, 220);
  const chartHeight = height || measured;
  const pad = { top: 22, right: 14, bottom: 40, left: 54 };
  const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
  const xTicks = scaledTicks(Math.min(0, ...xs), Math.max(...xs), 5, xScale);
  const span = Math.max(...ys) - Math.min(...ys) || 1;
  const yTicks = scaledTicks(Math.min(...ys) - span * 0.05, Math.max(...ys) + span * 0.05, 4, yScale, yKind);
  const innerWidth = width - pad.left - pad.right, innerHeight = chartHeight - pad.top - pad.bottom;
  const x = (value) => pad.left + (value - xTicks[0]) / (xTicks.at(-1) - xTicks[0]) * innerWidth;
  const yFraction = (value) => (value - yTicks[0]) / (yTicks.at(-1) - yTicks[0]);
  const y = (value) => invertY ? pad.top + yFraction(value) * innerHeight : pad.top + innerHeight - yFraction(value) * innerHeight;
  const root = svg("svg", { viewBox: `0 0 ${width} ${chartHeight}`, role: "group", "aria-label": ariaLabel });
  yTicks.forEach((tick) => {
    root.append(svg("line", { class: "axis", x1: pad.left, x2: width - pad.right, y1: y(tick), y2: y(tick) }));
    root.append(svg("text", { class: "label", x: pad.left - 8, y: y(tick) + 4, "text-anchor": "end" }, [document.createTextNode(yFormat(tick))]));
  });
  xTicks.forEach((tick) => root.append(svg("text", { class: "label", x: x(tick), y: pad.top + innerHeight + 16, "text-anchor": "middle" }, [document.createTextNode(xFormat(tick))])));
  root.append(svg("text", { class: "axis-title", x: pad.left + innerWidth, y: chartHeight - 4, "text-anchor": "end" }, [document.createTextNode(xTitle)]));
  root.append(svg("text", { class: "axis-title", x: pad.left, y: 12 }, [document.createTextNode(yTitle)]));
  points.forEach((point) => {
    const dot = svg("circle", { class: `scatter-dot ${point.className || ""}`, cx: x(point.x), cy: y(point.y), r: 5 });
    attachTooltip(dot, point.title, point.rows);
    if (point.open) {
      dot.classList.add("chart-action");
      dot.setAttribute("role", "button");
      dot.setAttribute("aria-label", `${point.title}. Open run details.`);
      dot.addEventListener("click", () => point.open(dot));
      dot.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); point.open(dot); } });
    }
    root.append(dot);
  });
  container.replaceChildren(root);
}

/*
 * Horizontal bar list in HTML: the label column sizes to its text, so long
 * labels never collide with bars, and it reflows on narrow screens.
 */
function barList(container, { rows, ariaLabel, className = "" }) {
  const max = Math.max(...rows.map((row) => row.value), 0);
  if (!max) { renderEmpty(container); return; }
  container.innerHTML = `<ul class="bar-list ${className}" aria-label="${escapeHtml(ariaLabel)}">${rows.map((row) => `
    <li${row.highlight ? ' class="highlight"' : ""}>
      <span class="bar-list-label">${escapeHtml(row.label)}</span>
      <span class="bar-list-track"><span class="bar-list-fill" style="width:${row.value ? Math.max(1.5, row.value / max * 100) : 0}%"></span></span>
      <span class="bar-list-value">${escapeHtml(row.display)}${row.sub ? `<small>${escapeHtml(row.sub)}</small>` : ""}</span>
    </li>`).join("")}</ul>`;
}

/*
 * Calendar heatmap: one column per week, one row per weekday, square cells.
 * Five ordered steps of one hue; the legend states the distance each covers.
 */
function calendarHeatmap(container, { start, end, days, valueOf, format, tooltip, action, ariaLabel }) {
  const first = TrainingCore.weekStart(start);
  const weeks = Math.max(1, Math.round((TrainingCore.weekStart(end) - first) / (7 * 86400000)) + 1);
  const available = Math.max(container.clientWidth || 0, 280);
  const labelWidth = 34;
  const cell = Math.max(11, Math.min(30, Math.floor((available - labelWidth) / weeks) - 3));
  const gap = 3;
  const width = labelWidth + weeks * (cell + gap);
  const height = 20 + 7 * (cell + gap);
  const values = [...days.values()].map(valueOf).filter((value) => value > 0).sort((a, b) => a - b);
  const max = values.at(-1) || 1;
  const thresholds = [0.25, 0.5, 0.75, 1].map((fraction) => max * fraction);
  const level = (value) => value <= 0 ? 0 : thresholds.findIndex((limit) => value <= limit) + 1;
  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "group", "aria-label": ariaLabel, class: "calendar-svg" });
  let lastMonth = -1;
  for (let week = 0; week < weeks; week += 1) {
    const weekDate = new Date(first.getFullYear(), first.getMonth(), first.getDate() + week * 7);
    // Label a month at the first week that contains its 1st.
    const monthStart = [...Array(7).keys()].map((offset) => new Date(weekDate.getFullYear(), weekDate.getMonth(), weekDate.getDate() + offset)).find((date) => date.getDate() === 1);
    const labelDate = week === 0 ? weekDate : monthStart;
    if (labelDate && labelDate.getMonth() !== lastMonth) {
      lastMonth = labelDate.getMonth();
      root.append(svg("text", { class: "label", x: labelWidth + week * (cell + gap), y: 12 }, [document.createTextNode(labelDate.toLocaleDateString(undefined, { month: "short" }))]));
    }
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(weekDate.getFullYear(), weekDate.getMonth(), weekDate.getDate() + day);
      if (date < new Date(start.getFullYear(), start.getMonth(), start.getDate()) || date > end) continue;
      const key = localDateValue(date);
      const stats = days.get(key);
      const value = stats ? valueOf(stats) : 0;
      const rect = svg("rect", { class: `heat heat-level-${level(value)}`, x: labelWidth + week * (cell + gap), y: 20 + day * (cell + gap), width: cell, height: cell, rx: 3 });
      const content = tooltip(date, stats);
      attachTooltip(rect, content.title, content.rows, { keyboard: Boolean(stats) });
      const target = stats ? action(date, stats) : null;
      if (target?.runs.length) attachChartAction(rect, target.title, target.runs);
      root.append(rect);
    }
  }
  ["Mon", "", "Wed", "", "Fri", "", "Sun"].forEach((label, day) => {
    if (label) root.append(svg("text", { class: "label", x: 0, y: 20 + day * (cell + gap) + cell * 0.75 }, [document.createTextNode(label)]));
  });
  const scroller = document.createElement("div");
  scroller.className = "calendar-scroll";
  scroller.append(root);
  const legend = document.createElement("div");
  legend.className = "calendar-legend";
  legend.innerHTML = `<span>Rest</span><i class="heat-swatch heat-level-0"></i>${thresholds.map((limit, index) => `<i class="heat-swatch heat-level-${index + 1}" title="up to ${escapeHtml(format(limit))}"></i>`).join("")}<span>${escapeHtml(format(max))} (busiest day)</span>`;
  container.replaceChildren(scroller, legend);
  scroller.scrollLeft = scroller.scrollWidth; // Most recent weeks first on narrow screens.
}
