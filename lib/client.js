window.__ModuleLoader__.load({
	id: "@local/usage-trends",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var react = require("react");

		/**
		 * 用量趋势视图 (@local/usage-trends)
		 * 会话头部「聊天/轨迹」旁新增「趋势」标签页,把持久化会话日志里的
		 * 逐请求 usage 数据画成 SVG 图表:
		 *  - 每请求 Token 堆叠柱(计费输入:未缓存/缓存读/缓存写 + 输出)
		 *  - 累计输入/输出曲线
		 *  - 每请求墙钟耗时柱
		 *  - 会话聚合统计卡片(请求数/轮次/合计/缓存命中率/耗时)
		 * 数据来源:标准连接层 connection.api.sessions.history,重启后自动恢复;
		 * 与轨迹视图互补——轨迹是逐请求明细表格,这里是同一批数据的图形视图。
		 */

		var PAGE_LIMIT = 200;
		var PAGE_SIZE = 100;
		var CACHE_TTL_MS = 20000;

		function addUsage(a, b) {
			if (b === null || b === undefined) return a;
			var cur = a === null || a === undefined ? { inputTokens: 0, outputTokens: 0 } : a;
			var next = {
				inputTokens: (cur.inputTokens || 0) + (b.inputTokens || 0),
				outputTokens: (cur.outputTokens || 0) + (b.outputTokens || 0),
			};
			if (cur.cacheReadTokens !== undefined || b.cacheReadTokens !== undefined) next.cacheReadTokens = (cur.cacheReadTokens || 0) + (b.cacheReadTokens || 0);
			if (cur.cacheWriteTokens !== undefined || b.cacheWriteTokens !== undefined) next.cacheWriteTokens = (cur.cacheWriteTokens || 0) + (b.cacheWriteTokens || 0);
			if (cur.reasoningTokens !== undefined || b.reasoningTokens !== undefined) next.reasoningTokens = (cur.reasoningTokens || 0) + (b.reasoningTokens || 0);
			return next;
		}

		/** 从持久化会话日志分页拉取全部事件并按 seq 升序去重,再折叠成逐请求数据点。 */
		async function fetchAllRequests(api, sessionId) {
			var all = [];
			var beforeSeq;
			for (var page = 0; page < PAGE_LIMIT; page++) {
				var payload = { sessionId: sessionId, maxMessages: PAGE_SIZE };
				if (beforeSeq !== undefined) payload.beforeSeq = beforeSeq;
				var res = await api.sessions.history(payload);
				var result = res && res.result;
				if (!result || !result.ok) {
					var err = result && result.error;
					throw new Error("history failed: " + (err ? (err.code || err.message || "unknown") : "transport"));
				}
				var entries = result.value && result.value.events;
				if (!entries || entries.length === 0) break;
				var oldestSeq = Infinity;
				for (var i = 0; i < entries.length; i++) {
					all.push(entries[i]);
					var s = entries[i].event && entries[i].event.seq;
					if (typeof s === "number" && s < oldestSeq) oldestSeq = s;
				}
				if (!result.value.hasMore) break;
				beforeSeq = oldestSeq;
			}
			all.sort(function (x, y) {
				var a = x.event && x.event.seq;
				var b = y.event && y.event.seq;
				if (typeof a !== "number") return typeof b !== "number" ? 0 : 1;
				if (typeof b !== "number") return -1;
				return a - b;
			});
			var points = [];
			var current = null;
			var seen = new Set();
			for (var e = 0; e < all.length; e++) {
				var entry = all[e];
				var ev = entry && entry.event;
				if (ev === undefined || ev === null) continue;
				if (typeof ev.seq === "number") {
					if (seen.has(ev.seq)) continue;
					seen.add(ev.seq);
				}
				if (ev.type !== "assistant/chunk" && ev.type !== "assistant/message") continue;
				var data = ev.data;
				if (data === undefined || data === null) continue;
				var key = String(data.turn) + ":" + String(data.step);
				if (current === null || current.key !== key) {
					if (current !== null && (current.usage !== null || current.sawMessage)) points.push(current);
					current = {
						key: key,
						turn: data.turn,
						step: data.step,
						seq: ev.seq,
						startedAt: typeof ev.time === "number" ? ev.time : null,
						completedAt: null,
						usage: null,
						sawMessage: false,
					};
				}
				if (current.startedAt === null && typeof ev.time === "number") current.startedAt = ev.time;
				if (ev.type === "assistant/chunk") {
					var chunk = data.chunk;
					if (chunk !== undefined && chunk !== null && chunk.type === "usage") current.usage = addUsage(current.usage, chunk.usage);
				} else if (ev.type === "assistant/message") {
					current.sawMessage = true;
					if (data.usage !== undefined && data.usage !== null) current.usage = data.usage;
					if (typeof ev.time === "number") current.completedAt = ev.time;
				}
			}
			if (current !== null && (current.usage !== null || current.sawMessage)) points.push(current);
			return points;
		}

		function billedInput(u) {
			if (u === null || u === undefined) return 0;
			return (u.inputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0);
		}
		function totalOf(u) {
			return billedInput(u) + (u && u.outputTokens || 0);
		}
		function fmt(n) {
			if (typeof n !== "number" || !Number.isFinite(n)) return "—";
			if (n < 1000) return String(Math.round(n));
			if (n < 1000000) return (n / 1000).toFixed(1) + "k";
			return (n / 1000000).toFixed(1) + "M";
		}
		function fmtDur(ms) {
			if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
			if (ms < 1000) return Math.round(ms) + "ms";
			if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
			var whole = Math.round(ms / 1000);
			return Math.floor(whole / 60) + "m" + (whole % 60) + "s";
		}
		function fmtTime(ts) {
			if (typeof ts !== "number" || !Number.isFinite(ts)) return "—";
			try {
				return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
			} catch (error) {
				return "—";
			}
		}

		var COLORS = {
			input: "var(--dsw-static-blue-450, #4d6bfe)",
			cacheRead: "var(--dsw-static-neutral-bluish-400, #8a93a6)",
			cacheWrite: "#a78bfa",
			output: "var(--dsw-alias-state-success-primary, #2ea56b)",
			duration: "var(--dsw-alias-state-warn-primary, #d9972c)",
			grid: "var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.22))",
		};

		var CSS = `
.utx-root {
  flex: 1;
  width: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-1);
}
.utx-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 20px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.utx-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.utx-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.utx-head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.utx-head-sub {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.utx-refresh {
  border: 1px solid var(--dsw-alias-border-l1);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.utx-refresh:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.utx-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.utx-card {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--dsw-alias-bg-base);
}
.utx-card .k {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}
.utx-card .v {
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary);
}
.utx-panel {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  padding: 14px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--dsw-alias-bg-base);
}
.utx-panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.utx-panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.utx-legend {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}
.utx-legend span { display: inline-flex; align-items: center; gap: 4px; }
.utx-swatch { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
.utx-chart-svg {
  width: 100%;
  height: 190px;
  display: block;
}
.utx-detail {
  min-height: 18px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}
.utx-empty {
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  padding: 24px 4px;
  line-height: 1.6;
}
.utx-note {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}
`

		function apply(ctx) {
			var connection = ctx.get("connection");
			var trendsCache = null;

			ctx.effect(function () {
				try {
					var el = document.createElement("style");
					el.setAttribute("data-plugin", "@local/usage-trends");
					el.textContent = CSS;
					document.head.appendChild(el);
					return function () { el.remove(); };
				} catch (error) {
					console.error("usage-trends: stylesheet failed", error);
				}
			}, "usage-trends: stylesheet");

			function gridLines(W, H, count) {
				var lines = [];
				for (var i = 1; i <= count; i++) {
					var y = Math.round(H * i / (count + 1));
					lines.push(react.createElement("line", {
						key: "g" + i,
						x1: 0, y1: y, x2: W, y2: y,
						stroke: COLORS.grid, strokeWidth: 1,
					}));
				}
				return lines;
			}

			function detailText(points, index, kind) {
				if (points === null || points.length === 0) return null;
				if (index === null || index === undefined || index < 0 || index >= points.length) return kind === null ? null : "悬停查看详情";
				var p = points[index];
				var u = p.usage;
				var dur = p.completedAt !== null && p.startedAt !== null ? Math.max(0, p.completedAt - p.startedAt) : null;
				var parts = [];
				parts.push("第 " + (index + 1) + " / " + points.length + " 次请求");
				if (typeof p.turn === "number") parts.push("T" + p.turn + "·S" + p.step);
				parts.push(fmtTime(p.startedAt));
				parts.push("计费输入 " + fmt(billedInput(u)));
				if (u !== null && u.cacheReadTokens !== undefined) parts.push("缓存读 " + fmt(u.cacheReadTokens));
				if (u !== null && u.cacheWriteTokens !== undefined) parts.push("缓存写 " + fmt(u.cacheWriteTokens));
				parts.push("输出 " + fmt(u && u.outputTokens));
				parts.push("耗时 " + fmtDur(dur));
				return parts.join(" · ");
			}

			/** 每请求 Token 堆叠柱:缓存读 → 未缓存输入 → 缓存写 → 输出。 */
			function TokenBars(points) {
				var hover = react.useState(null);
				var hoverIdx = hover[0];
				var setHoverIdx = hover[1];
				var W = 800;
				var H = 170;
				var maxTotal = 1;
				for (var i = 0; i < points.length; i++) maxTotal = Math.max(maxTotal, totalOf(points[i].usage));
				var slot = points.length > 0 ? W / points.length : W;
				var barW = Math.max(2, Math.min(46, slot * 0.72));
				var rects = [];
				for (var j = 0; j < points.length; j++) {
					var p = points[j];
					var u = p.usage;
					var x = Math.round(j * slot + (slot - barW) / 2);
					var total = totalOf(u);
					var h = total > 0 ? Math.max(1.5, total / maxTotal * H) : 0;
					var y = H - h;
					var segs = [];
					var acc = 0;
					var rows = [
						{ v: u !== null ? (u.cacheReadTokens || 0) : 0, c: COLORS.cacheRead, label: "缓存读" },
						{ v: u !== null ? (u.inputTokens || 0) : 0, c: COLORS.input, label: "未缓存输入" },
						{ v: u !== null ? (u.cacheWriteTokens || 0) : 0, c: COLORS.cacheWrite, label: "缓存写" },
					];
					for (var r = 0; r < rows.length; r++) {
						if (rows[r].v <= 0) continue;
						var sh = rows[r].v / maxTotal * H;
						segs.push(react.createElement("rect", {
							key: "s" + r,
							x: x, y: H - acc - sh, width: barW, height: sh,
							fill: rows[r].c,
						}));
						acc += sh;
					}
					var ov = u !== null ? (u.outputTokens || 0) : 0;
					if (ov > 0) {
						var oh = ov / maxTotal * H;
						segs.push(react.createElement("rect", {
							key: "out",
							x: x, y: H - acc - oh, width: barW, height: oh,
							fill: COLORS.output,
						}));
						acc += oh;
					}
					var dur = p.completedAt !== null && p.startedAt !== null ? Math.max(0, p.completedAt - p.startedAt) : null;
					var title = "第 " + (j + 1) + " 次请求 · T" + p.turn + "·S" + p.step + "\n计费输入 " + fmt(billedInput(u)) + " · 输出 " + fmt(ov) + "\n缓存读 " + fmt(u !== null && u.cacheReadTokens) + " · 缓存写 " + fmt(u !== null && u.cacheWriteTokens) + "\n耗时 " + fmtDur(dur);
					rects.push(react.createElement("g", {
						key: j,
						opacity: hoverIdx === j ? 1 : 0.92,
						onMouseEnter: function () { setHoverIdx(j); },
						onMouseLeave: function () { setHoverIdx(function (v) { return v === j ? null : v; }); },
					},
						react.createElement("rect", {
							x: x, y: hoverIdx === j ? y - 1 : y, width: barW, height: hoverIdx === j ? h + 1 : h,
							fill: "transparent",
						}),
						segs,
						react.createElement("title", null, title),
					));
				}
				return react.createElement("div", { className: "utx-panel" },
					react.createElement("div", { className: "utx-panel-head" },
						react.createElement("span", { className: "utx-panel-title" }, "每请求 Token 流量"),
						react.createElement("span", { className: "utx-legend" },
							react.createElement("span", null, react.createElement("i", { className: "utx-swatch", style: { backgroundColor: COLORS.input } }), "未缓存输入"),
							react.createElement("span", null, react.createElement("i", { className: "utx-swatch", style: { backgroundColor: COLORS.cacheRead } }), "缓存读"),
							react.createElement("span", null, react.createElement("i", { className: "utx-swatch", style: { backgroundColor: COLORS.cacheWrite } }), "缓存写"),
							react.createElement("span", null, react.createElement("i", { className: "utx-swatch", style: { backgroundColor: COLORS.output } }), "输出"),
						),
					),
					react.createElement("svg", { className: "utx-chart-svg", viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none" },
						gridLines(W, H, 3),
						rects,
					),
					react.createElement("div", { className: "utx-detail" }, detailText(points, hoverIdx, "bars")),
					react.createElement("div", { className: "utx-note" }, "纵轴峰值 " + fmt(maxTotal) + " tokens · 共 " + points.length + " 次请求"),
				);
			}

			/** 累计计费输入/输出曲线。 */
			function CumulativeLines(points) {
				var W = 800;
				var H = 170;
				var cumIn = [];
				var cumOut = [];
				var runIn = 0;
				var runOut = 0;
				for (var i = 0; i < points.length; i++) {
					runIn += billedInput(points[i].usage);
					runOut += points[i].usage !== null ? (points[i].usage.outputTokens || 0) : 0;
					cumIn.push(runIn);
					cumOut.push(runOut);
				}
				var maxV = Math.max(1, runIn, runOut);
				function toPoints(values) {
					var parts = [];
					if (values.length === 0) return "";
					var step = W / Math.max(1, values.length - 1);
					for (var k = 0; k < values.length; k++) {
						var x = values.length === 1 ? W : Math.round(k * step);
						var y = H - values[k] / maxV * H;
						parts.push(x + "," + y.toFixed(1));
					}
					return parts.join(" ");
				}
				var inLine = toPoints(cumIn);
				var outLine = toPoints(cumOut);
				var area = null;
				if (cumIn.length > 1) {
					var step = W / (cumIn.length - 1);
					var poly = "0," + H;
					for (var m = 0; m < cumIn.length; m++) {
						var px = m * step;
						var py = H - cumIn[m] / maxV * H;
						poly += " " + px.toFixed(1) + "," + py.toFixed(1);
					}
					poly += " " + W + "," + H;
					area = react.createElement("polygon", { points: poly, fill: COLORS.input, opacity: 0.1 });
				}
				return react.createElement("div", { className: "utx-panel" },
					react.createElement("div", { className: "utx-panel-head" },
						react.createElement("span", { className: "utx-panel-title" }, "累计 Token 曲线"),
						react.createElement("span", { className: "utx-legend" },
							react.createElement("span", null, react.createElement("i", { className: "utx-swatch", style: { backgroundColor: COLORS.input } }), "计费输入"),
							react.createElement("span", null, react.createElement("i", { className: "utx-swatch", style: { backgroundColor: COLORS.output } }), "输出"),
						),
					),
					react.createElement("svg", { className: "utx-chart-svg", viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none" },
						gridLines(W, H, 3),
						area,
						react.createElement("polyline", { points: inLine, fill: "none", stroke: COLORS.input, strokeWidth: 2 }),
						react.createElement("polyline", { points: outLine, fill: "none", stroke: COLORS.output, strokeWidth: 2 }),
					),
					react.createElement("div", { className: "utx-note" }, "纵轴峰值 " + fmt(maxV) + " tokens · 最终累计:输入 " + fmt(runIn) + " / 输出 " + fmt(runOut)),
				);
			}

			/** 每请求墙钟耗时柱。 */
			function DurationBars(points) {
				var hover = react.useState(null);
				var hoverIdx = hover[0];
				var setHoverIdx = hover[1];
				var W = 800;
				var H = 120;
				var maxDur = 1;
				for (var i = 0; i < points.length; i++) {
					if (points[i].completedAt !== null && points[i].startedAt !== null) {
						maxDur = Math.max(maxDur, points[i].completedAt - points[i].startedAt);
					}
				}
				var slot = points.length > 0 ? W / points.length : W;
				var barW = Math.max(2, Math.min(46, slot * 0.72));
				var rects = [];
				for (var j = 0; j < points.length; j++) {
					var p = points[j];
					var dur = p.completedAt !== null && p.startedAt !== null ? Math.max(0, p.completedAt - p.startedAt) : 0;
					if (dur <= 0) continue;
					var x = Math.round(j * slot + (slot - barW) / 2);
					var h = Math.max(1.5, dur / maxDur * H);
					var y = H - h;
					rects.push(react.createElement("rect", {
						key: j,
						x: x, y: y, width: barW, height: h,
						fill: COLORS.duration,
						opacity: hoverIdx === j ? 1 : 0.85,
						onMouseEnter: function () { setHoverIdx(j); },
						onMouseLeave: function () { setHoverIdx(function (v) { return v === j ? null : v; }); },
					},
						react.createElement("title", null, "第 " + (j + 1) + " 次请求 · 耗时 " + fmtDur(dur) + " · " + fmtTime(p.startedAt) + " → " + fmtTime(p.completedAt)),
					));
				}
				return react.createElement("div", { className: "utx-panel" },
					react.createElement("div", { className: "utx-panel-head" },
						react.createElement("span", { className: "utx-panel-title" }, "每请求耗时(墙钟)"),
						react.createElement("span", { className: "utx-legend" },
							react.createElement("span", null, react.createElement("i", { className: "utx-swatch", style: { backgroundColor: COLORS.duration } }), "请求耗时"),
						),
					),
					react.createElement("svg", { className: "utx-chart-svg", viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none" },
						gridLines(W, H, 2),
						rects,
					),
					react.createElement("div", { className: "utx-detail" }, detailText(points, hoverIdx, "dur")),
					react.createElement("div", { className: "utx-note" }, "峰值 " + fmtDur(maxDur)),
				);
			}

			function StatsCards(points) {
				var requests = points.length;
				var turns = 0;
				var inTotal = 0;
				var outTotal = 0;
				var cacheRead = 0;
				var cacheWrite = 0;
				var durTotal = 0;
				var durCount = 0;
				var peak = 0;
				for (var i = 0; i < points.length; i++) {
					var p = points[i];
					if (typeof p.turn === "number") turns = Math.max(turns, p.turn);
					var u = p.usage;
					inTotal += billedInput(u);
					outTotal += u !== null ? (u.outputTokens || 0) : 0;
					cacheRead += u !== null ? (u.cacheReadTokens || 0) : 0;
					cacheWrite += u !== null ? (u.cacheWriteTokens || 0) : 0;
					peak = Math.max(peak, totalOf(u));
					if (p.completedAt !== null && p.startedAt !== null) {
						durTotal += Math.max(0, p.completedAt - p.startedAt);
						durCount++;
					}
				}
				var hitPct = inTotal > 0 ? Math.round(cacheRead / inTotal * 100) : null;
				var avgDur = durCount > 0 ? Math.round(durTotal / durCount) : null;
				var cards = [
					{ k: "请求数", v: String(requests) },
					{ k: "用户轮次", v: turns > 0 ? String(turns) : "—" },
					{ k: "计费输入", v: fmt(inTotal) },
					{ k: "输出", v: fmt(outTotal) },
					{ k: "缓存命中率", v: hitPct === null ? "—" : hitPct + "%" },
					{ k: "单请求峰值", v: fmt(peak) },
					{ k: "总耗时", v: fmtDur(durTotal) },
					{ k: "平均耗时", v: fmtDur(avgDur) },
				];
				return react.createElement("div", { className: "utx-cards" },
					cards.map(function (c) {
						return react.createElement("div", { key: c.k, className: "utx-card" },
							react.createElement("span", { className: "k" }, c.k),
							react.createElement("span", { className: "v" }, c.v),
						);
					}),
				);
			}

			function TrendsView(props) {
				var sessionId = props.sessionId;
				var running = props.useSession(function (s) { return s.running; });
				var openState = props.useSession(function (s) { return s.openState; });
				var stateHook = react.useState(null);
				var state = stateHook[0];
				var setState = stateHook[1];
				var refreshTick = react.useState(0);
				var tick = refreshTick[0];
				var setTick = refreshTick[1];
				var wasRunningRef = react.useRef(null);

				react.useEffect(function () {
					var wasRunning = wasRunningRef.current;
					wasRunningRef.current = running;
					if (sessionId === undefined || sessionId === null || connection === undefined) {
						setState({ status: "error", error: "无会话或无连接服务,无法读取会话历史。" });
						return;
					}
					var force = wasRunning === true && running === false;
					var cached = trendsCache;
					var fresh = !force && cached !== null && cached.sessionId === sessionId && Date.now() - cached.at < CACHE_TTL_MS;
					if (fresh) {
						setState({ status: "ok", points: cached.points, at: cached.at });
						return;
					}
					var cancelled = false;
					var reuse = state !== null && state.points !== null && state.sessionId === sessionId ? state.points : null;
					if (reuse === null && cached !== null && cached.sessionId === sessionId) reuse = cached.points;
					setState({ status: "loading", points: reuse, sessionId: sessionId });
					fetchAllRequests(connection.api, sessionId).then(function (points) {
						if (cancelled) return;
						var at = Date.now();
						trendsCache = { sessionId: sessionId, points: points, at: at };
						setState({ status: "ok", points: points, at: at });
					}).catch(function (error) {
						console.error("usage-trends: history fetch failed", error);
						if (!cancelled) setState({ status: "error", error: error && error.message ? error.message : String(error) });
					});
					return function () { cancelled = true; };
				}, [sessionId, running, openState, tick, connection]);

				var points = state !== null && state.points !== null ? state.points : null;
				var status = state !== null ? state.status : "loading";
				var head = react.createElement("div", { className: "utx-head" },
					react.createElement("div", null,
						react.createElement("h3", null, "用量趋势"),
						react.createElement("span", { className: "utx-head-sub" },
							status === "ok" && state !== null && state.at !== undefined
								? "数据来自持久化会话日志 · 更新于 " + fmtTime(state.at)
								: "数据来自持久化会话日志 · 重启后自动恢复",
						),
					),
					react.createElement("button", {
						type: "button",
						className: "utx-refresh",
						onClick: function () { setTick(function (t) { return t + 1; }); },
					}, "刷新"),
				);
				var body = null;
				if (status === "error") {
					body = react.createElement("div", { className: "utx-empty" }, "读取会话历史失败:" + String(state !== null && state.error ? state.error : "未知错误"));
				} else if (points !== null && points.length === 0) {
					body = react.createElement("div", { className: "utx-empty" },
						"本会话还没有已完成并上报用量的模型请求。",
						react.createElement("br", null),
						"发一条消息、跑完一个回合后点击「刷新」即可看到图表。",
					);
				} else if (points !== null && points.length > 0) {
					body = react.createElement("div", { className: "utx-body" },
						StatsCards(points),
						TokenBars(points),
						CumulativeLines(points),
						DurationBars(points),
						react.createElement("div", { className: "utx-note" }, "提示:逐请求明细请切换到「轨迹」标签页;本页是把同一批持久化数据画成图。"),
					);
				} else {
					body = react.createElement("div", { className: "utx-empty" }, "正在读取会话历史…");
				}
				return react.createElement("div", { className: "utx-root" },
					react.createElement("div", { className: "utx-scroll" },
						head,
						body,
					),
				);
			}

			ctx.effect(function () {
				try {
					return ctx.slots.inject("conversation.view", function () {
						return ctx.slots.register(
							{ name: "conversation.view", id: "usage-trends", order: 20, label: function () { return "趋势"; } },
							TrendsView,
						);
					});
				} catch (error) {
					console.error("usage-trends: view registration failed", error);
				}
			}, "usage-trends: view tab");
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		exports.name = "@local/usage-trends";
		return module.exports;
	},
});
