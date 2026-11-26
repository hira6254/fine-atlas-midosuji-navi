/* ==========================================================================
   FINE ATLAS — 御堂筋線（江坂〜梅田）チラシ訪問＆関係構築ナビ (app.js)
   Rookie-Friendly Interactive Logic: Subway Route, Call Window & Closed-Day
   Radar, 3-Step Scripts, Teleprompter Modal, Mobile Route URL Sync & CSV Export
   ========================================================================== */

(function () {
  "use strict";

  const STORAGE_KEY = "fine_atlas_midosuji_tomita_crm_v1";
  const THEME_KEY = "fine_atlas_midosuji_theme_v1";

  const STORES = window.FINE_ATLAS_MIDOSUJI_STORES || [];
  const STATIONS = window.FINE_ATLAS_STATIONS || [];
  const FISH_CATALOG = window.FINE_ATLAS_FISH_CATALOG || [];
  const FUNNEL_STAGES = window.FINE_ATLAS_FUNNEL_STAGES || [];
  const OBJECTIONS = window.FINE_ATLAS_OBJECTIONS || [];
  const COMPANY_BIBLE = window.FINE_ATLAS_COMPANY_BIBLE || {};

  const STATION_ORDER = ["M11", "M12", "M13", "M14", "M15", "M16", "M16S"];
  const WEEKDAY_JP = ["日曜", "月曜", "火曜", "水曜", "木曜", "金曜", "土曜"];

  const state = {
    activeTab: "list",
    station: "ALL",
    fish: "ALL",
    search: "",
    segment: "ALL",
    statusFilter: "ALL",
    sort: "priority",
    quickTags: new Set(),
    routeDirection: "south", // "south" (江坂→梅田) or "north" (梅田→江坂)
    teleprompterStoreId: null,
    teleprompterStep: "call",
    crm: loadCrmState()
  };

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function loadCrmState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_e) {
      return {};
    }
  }

  function saveCrmState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.crm));
    } catch (_e) {
      // Ignore storage quota errors
    }
  }

  function getCrm(id) {
    const rec = state.crm[String(id)] || {};
    return {
      status: rec.status || "未架電",
      memo: rec.memo || "",
      visitDate: rec.visitDate || "",
      starred: Boolean(rec.starred),
      routeExcluded: Boolean(rec.routeExcluded),
      scriptStep: rec.scriptStep || "call"
    };
  }

  function updateCrm(id, patch) {
    const key = String(id);
    const current = getCrm(key);
    state.crm[key] = Object.assign({}, current, patch);
    saveCrmState();
    refreshCountersAndKpis();
  }

  // Import route selection from URL hash (#route=1,5,12) for instant PC -> Smartphone transfer
  function importRouteFromHash() {
    const hash = window.location.hash || "";
    const match = hash.match(/route=([0-9,]+)/);
    if (!match) return;
    const ids = match[1]
      .split(",")
      .map((s) => parseInt(s, 10))
      .filter((n) => !Number.isNaN(n));
    if (!ids.length) return;
    ids.forEach((id) => {
      const cur = getCrm(id);
      state.crm[String(id)] = Object.assign({}, cur, { starred: true, routeExcluded: false });
    });
    saveCrmState();
    state.activeTab = "route";
    showToast("📱 URLから今日の訪問ルート（" + ids.length + "店舗）を読み込みました！");
  }

  // JST Live Clock & Closed Day Check
  function getJstNow() {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    const parts = fmt.formatToParts(now);
    let h = 0;
    let m = 0;
    let wd = "Mon";
    for (const p of parts) {
      if (p.type === "hour") h = parseInt(p.value, 10) % 24;
      if (p.type === "minute") m = parseInt(p.value, 10);
      if (p.type === "weekday") wd = p.value;
    }
    const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dayIdx = wdMap[wd] != null ? wdMap[wd] : 1;
    return {
      h,
      m,
      totalMinutes: h * 60 + m,
      dayIdx,
      weekdayJp: WEEKDAY_JP[dayIdx]
    };
  }

  function isLikelyClosedToday(closedDayStr, weekdayJp) {
    if (!closedDayStr || closedDayStr.includes("無休")) {
      return false;
    }
    const mainPart = closedDayStr
      .replace(/（[^）]*）|\([^)]*\)/g, " ")
      .replace(/第[1-5][日月火水木金土]曜日?/g, " ")
      .replace(/[日月火水木金土]曜?不定休/g, " ")
      .replace(/不定休/g, " ")
      .trim();
    if (!mainPart) return false;
    const shortDay = weekdayJp.charAt(0);
    if (mainPart.includes(weekdayJp)) return true;
    const tokens = mainPart
      .replace(/曜日/g, "曜")
      .split(/[・,／/\s]+/)
      .filter(Boolean);
    return tokens.some((t) => t === shortDay || t === weekdayJp);
  }

  function isWithinCallWindow(windowStr, totalMinutes) {
    if (!windowStr) return false;
    const cleaned = windowStr.replace(/（[^）]*）|\([^)]*\)/g, " ");
    const ranges = cleaned.split(/[\n/／・,]+/);
    for (const r of ranges) {
      const m = r.match(/(\d{1,2}):(\d{2})\s*[〜~\-]\s*(\d{1,2}):(\d{2})/);
      if (m) {
        const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        const end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
        if (totalMinutes >= start && totalMinutes <= end) {
          return true;
        }
      }
    }
    return false;
  }

  function isRouteStore(store) {
    const crm = getCrm(store.id);
    return (
      crm.starred ||
      (!crm.routeExcluded &&
        (crm.status === "チラシ手渡しアポ獲得" || crm.status === "ポスト投函OK"))
    );
  }

  let toastTimer = null;
  function showToast(message) {
    const el = document.getElementById("toast-notice");
    if (!el) return;
    el.textContent = message;
    el.classList.add("is-visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("is-visible");
    }, 2800);
  }

  function copyText(text, label) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showToast("📋 " + label + " をコピーしました！"),
        () => fallbackCopy(text, label)
      );
    } else {
      fallbackCopy(text, label);
    }
  }

  function fallbackCopy(text, label) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      showToast("📋 " + label + " をコピーしました！");
    } catch (_e) {
      showToast("コピーに失敗しました");
    }
    document.body.removeChild(ta);
  }

  // ==========================================================================
  // KPI & Clock Updates
  // ==========================================================================
  function refreshCountersAndKpis() {
    const jst = getJstNow();
    const hh = String(jst.h).padStart(2, "0");
    const mm = String(jst.m).padStart(2, "0");

    const clockEl = document.getElementById("live-jst-clock");
    if (clockEl) {
      clockEl.textContent = "JST " + hh + ":" + mm + "（" + jst.weekdayJp + "）";
    }

    const total = STORES.length;
    const sCount = STORES.filter((s) => s.rank === "S").length;
    const aCount = total - sCount;

    let goldenCount = 0;
    let flyerOkCount = 0;
    let visitedCount = 0;
    let trialContractCount = 0;
    let routeCount = 0;

    for (const st of STORES) {
      const closed = isLikelyClosedToday(st.closedDay, jst.weekdayJp);
      if (!closed && isWithinCallWindow(st.callWindow, jst.totalMinutes)) {
        goldenCount++;
      }
      const crm = getCrm(st.id);
      if (crm.status === "ポスト投函OK" || crm.status === "チラシ手渡しアポ獲得") {
        flyerOkCount++;
      }
      if (crm.status === "1回目チラシ訪問済" || crm.status === "2〜3回目関係構築中") {
        visitedCount++;
      }
      if (crm.status === "お試しセット案内済" || crm.status === "定期便商談・契約") {
        trialContractCount++;
      }
      if (isRouteStore(st)) {
        routeCount++;
      }
    }

    const setTxt = (id, val) => {
      const node = document.getElementById(id);
      if (node) node.textContent = val;
    };

    setTxt("badge-total-stores", String(total));
    setTxt("badge-route-count", String(routeCount));
    setTxt("kpi-total-stores", total + " 店舗");
    setTxt("kpi-rank-split", "Sランク " + sCount + "店 ／ Aランク " + aCount + "店");
    setTxt("kpi-golden-now", goldenCount + " 店舗");
    setTxt("kpi-today-weekday", "本日：" + jst.weekdayJp + "（定休除外・推奨時間内）");
    setTxt("kpi-flyer-ok", (flyerOkCount + visitedCount + trialContractCount) + " 店舗");
    setTxt("kpi-visited-count", visitedCount + " 店舗");
    setTxt("kpi-trial-contract", trialContractCount + " 店舗");
  }

  // ==========================================================================
  // Subway Station Track & Fish Filter Bar
  // ==========================================================================
  function renderStationTrack() {
    const wrap = document.getElementById("subway-station-track");
    const banner = document.getElementById("station-guide-banner");
    if (!wrap) return;

    const counts = { ALL: STORES.length };
    for (const s of STORES) {
      counts[s.stationCode] = (counts[s.stationCode] || 0) + 1;
    }

    wrap.innerHTML = STATIONS.map((st) => {
      const active = state.station === st.code ? " is-active" : "";
      const cnt = counts[st.code] || 0;
      const meta =
        st.rideMin == null
          ? "江坂〜梅田 全区間"
          : st.rideMin === 0
          ? "拠点徒歩圏・運賃¥0"
          : "江坂から" + st.rideMin + "分・¥" + st.fareYen;
      return (
        '<button type="button" class="station-node-btn' +
        active +
        '" data-st-code="' +
        escapeHtml(st.code) +
        '">' +
        '<span class="station-node-top">' +
        '<span class="station-code-pill">' +
        escapeHtml(st.lineBadge) +
        "</span>" +
        '<span class="station-count-num">' +
        cnt +
        "店</span>" +
        "</span>" +
        '<span class="station-node-name">' +
        escapeHtml(st.shortName) +
        "</span>" +
        '<span class="station-node-meta">' +
        escapeHtml(meta) +
        "</span>" +
        "</button>"
      );
    }).join("");

    wrap.querySelectorAll(".station-node-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.station = btn.getAttribute("data-st-code") || "ALL";
        renderStationTrack();
        renderStoresGrid();
      });
    });

    if (banner) {
      const selected = STATIONS.find((x) => x.code === state.station) || STATIONS[0];
      if (selected) {
        banner.innerHTML =
          "<div><strong>📍 " +
          escapeHtml(selected.name) +
          "：</strong>" +
          escapeHtml(selected.areaNote) +
          "</div>" +
          '<div style="color:var(--ink-secondary);">💡 ' +
          escapeHtml(selected.walkTip) +
          "</div>";
      }
    }
  }

  function renderFishBar() {
    const bar = document.getElementById("fish-filter-bar");
    if (!bar) return;

    const selectedFish = FISH_CATALOG.find((f) => f.key === state.fish) || FISH_CATALOG[0];
    const buttonsHtml = FISH_CATALOG.map((f) => {
      const active = state.fish === f.key ? " is-active" : "";
      return (
        '<button type="button" class="fish-chip' +
        active +
        '" data-fish-key="' +
        escapeHtml(f.key) +
        '">' +
        "<span>" +
        escapeHtml(f.icon) +
        "</span>" +
        "<span>" +
        escapeHtml(f.label) +
        "</span>" +
        "</button>"
      );
    }).join("");

    const pitchHtml = selectedFish
      ? '<div class="fish-pitch-note"><strong>' +
        escapeHtml(selectedFish.icon + " " + selectedFish.label) +
        "（" +
        escapeHtml(selectedFish.prepForms) +
        "）：</strong> " +
        escapeHtml(selectedFish.pitchPoint) +
        "</div>"
      : "";

    bar.innerHTML = buttonsHtml + pitchHtml;

    bar.querySelectorAll(".fish-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.fish = btn.getAttribute("data-fish-key") || "ALL";
        renderFishBar();
        renderStoresGrid();
      });
    });
  }

  // ==========================================================================
  // Filtering, Sorting & Rendering Store Cards
  // ==========================================================================
  function getFilteredStores() {
    const jst = getJstNow();
    const q = state.search.trim().toLowerCase();

    const list = STORES.filter((st) => {
      const crm = getCrm(st.id);

      if (state.station !== "ALL" && st.stationCode !== state.station) return false;
      if (state.segment !== "ALL" && st.segmentCode !== state.segment) return false;
      if (state.statusFilter !== "ALL" && crm.status !== state.statusFilter) return false;
      if (state.fish !== "ALL" && !(st.fishTags || []).includes(state.fish)) return false;

      if (state.quickTags.has("GOLDEN_NOW")) {
        const closed = isLikelyClosedToday(st.closedDay, jst.weekdayJp);
        if (closed || !isWithinCallWindow(st.callWindow, jst.totalMinutes)) return false;
      }
      if (state.quickTags.has("STARRED_ROUTE") && !isRouteStore(st)) return false;
      if (state.quickTags.has("UNCALLED_ONLY") && crm.status !== "未架電") return false;
      if (state.quickTags.has("DIRECT_06") && !String(st.phone || "").startsWith("06-")) return false;

      if (q) {
        const hay = [
          st.name,
          st.kana,
          st.stationGroup,
          st.stationDetail,
          st.address,
          st.phone,
          st.genre,
          st.hookProduct,
          st.menuEvidence,
          st.whyFit,
          crm.memo
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      const idxA = STATION_ORDER.indexOf(a.stationCode);
      const idxB = STATION_ORDER.indexOf(b.stationCode);

      if (state.sort === "esaka_near") {
        if (idxA !== idxB) return idxA - idxB;
        return (a.walkMinutes || 5) - (b.walkMinutes || 5);
      }
      if (state.sort === "umeda_near") {
        if (idxA !== idxB) return idxB - idxA;
        return (a.walkMinutes || 5) - (b.walkMinutes || 5);
      }
      if (state.sort === "walk_short") {
        if ((a.walkMinutes || 5) !== (b.walkMinutes || 5)) {
          return (a.walkMinutes || 5) - (b.walkMinutes || 5);
        }
        return idxA - idxB;
      }
      // default: priority (S -> A, then Esaka near, then walkMinutes)
      if (a.rank !== b.rank) return a.rank === "S" ? -1 : 1;
      if (idxA !== idxB) return idxA - idxB;
      return (a.walkMinutes || 5) - (b.walkMinutes || 5);
    });

    return list;
  }

  function getScriptByStep(store, stepKey) {
    if (stepKey === "visit1") return store.visit1FlyerPitch || "";
    if (stepKey === "visit2") return store.visit2RelationPitch || "";
    return store.callFlyerPitch || "";
  }

  function renderStoresGrid() {
    const grid = document.getElementById("stores-card-grid");
    const countLabel = document.getElementById("label-result-count");
    if (!grid) return;

    const jst = getJstNow();
    const filtered = getFilteredStores();

    if (countLabel) {
      countLabel.textContent = "表示中: " + filtered.length + " / 全 " + STORES.length + " 店舗";
    }

    if (!filtered.length) {
      grid.innerHTML =
        '<div class="section-card" style="grid-column:1/-1; text-align:center; padding:36px;">' +
        '<p style="margin:0 0 10px; font-weight:700;">条件に一致する店舗がありません。</p>' +
        '<button type="button" data-action="empty-reset" class="btn btn-outline btn-sm">絞り込み条件を解除する</button>' +
        "</div>";
      const resetBtn = grid.querySelector('[data-action="empty-reset"]');
      if (resetBtn) resetBtn.addEventListener("click", resetAllFilters);
      return;
    }

    grid.innerHTML = filtered
      .map((st) => {
        const crm = getCrm(st.id);
        const closedToday = isLikelyClosedToday(st.closedDay, jst.weekdayJp);
        const callNow = !closedToday && isWithinCallWindow(st.callWindow, jst.totalMinutes);
        const stepKey = crm.scriptStep || "call";
        const activeScript = getScriptByStep(st, stepKey);
        const mapQuery = encodeURIComponent(st.name + " " + st.address);
        const mapUrl = "https://www.google.com/maps/search/?api=1&query=" + mapQuery;
        const telHref = "tel:" + String(st.phone || "").replace(/[^0-9+]/g, "");

        let liveBadge = "";
        if (closedToday) {
          liveBadge = '<span class="badge-closed-warn">⚠️ 本日定休の可能性（' + escapeHtml(st.closedDay) + "）</span>";
        } else if (callNow) {
          liveBadge = '<span class="badge-call-ok">🟢 今が架電チャンス（' + escapeHtml(st.callWindow) + "）</span>";
        }

        const fishTagsHtml = (st.fishTags || [])
          .map((t) => '<span class="mini-fish-tag">' + escapeHtml(t) + "</span>")
          .join("");

        const statusOptions = [
          "未架電",
          "不在・再架電",
          "ポスト投函OK",
          "チラシ手渡しアポ獲得",
          "1回目チラシ訪問済",
          "2〜3回目関係構築中",
          "お試しセット案内済",
          "定期便商談・契約",
          "見送り・対象外"
        ]
          .map((opt) => {
            const sel = crm.status === opt ? " selected" : "";
            return '<option value="' + escapeHtml(opt) + '"' + sel + ">" + escapeHtml(opt) + "</option>";
          })
          .join("");

        const rideText =
          st.rideFromEsakaMin === 0
            ? "江坂徒歩圏"
            : "江坂から電車" + st.rideFromEsakaMin + "分";

        return (
          '<article class="store-card" data-store-id="' +
          st.id +
          '">' +
          '<div class="store-card-top">' +
          '<div class="badge-cluster">' +
          '<span class="badge-station">' +
          escapeHtml(st.stationGroup) +
          "｜徒歩" +
          escapeHtml(st.walkMinutes) +
          "分（" +
          escapeHtml(rideText) +
          "）</span>" +
          '<span class="badge-rank-' +
          escapeHtml(st.rank) +
          '">ランク' +
          escapeHtml(st.rank) +
          "</span>" +
          liveBadge +
          "</div>" +
          '<button type="button" class="route-star-btn' +
          (crm.starred ? " is-starred" : "") +
          '" data-action="toggle-star" data-id="' +
          st.id +
          '">' +
          (crm.starred ? "⭐ 訪問ルート登録済" : "☆ 訪問ルートに追加") +
          "</button>" +
          "</div>" +
          '<div class="store-title-block">' +
          "<h3>" +
          escapeHtml(st.id + ". " + st.name) +
          "</h3>" +
          '<div class="store-sub-meta">' +
          "<span>🍴 " +
          escapeHtml(st.genre) +
          "</span>" +
          "<span>💴 " +
          escapeHtml(st.priceRange) +
          "</span>" +
          "<span>🗓️ 定休: " +
          escapeHtml(st.closedDay) +
          "</span>" +
          "<span>📞 架電推奨: " +
          escapeHtml(st.callWindow) +
          "</span>" +
          "</div>" +
          '<div style="font-size:0.8rem; color:var(--ink-muted); margin-top:3px;">📍 ' +
          escapeHtml(st.address) +
          "（" +
          escapeHtml(st.stationDetail) +
          "）</div>" +
          "</div>" +
          '<div class="store-quick-actions">' +
          '<a href="' +
          escapeHtml(telHref) +
          '" class="tel-call-link">📞 ' +
          escapeHtml(st.phone) +
          "</a>" +
          '<span class="phone-type-tag">' +
          escapeHtml(st.phoneType || "店舗電話") +
          "</span>" +
          '<button type="button" class="btn btn-outline btn-sm" data-action="copy-phone" data-phone="' +
          escapeHtml(st.phone) +
          '">番号コピー</button>' +
          '<a href="' +
          escapeHtml(mapUrl) +
          '" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm">🗺️ Googleマップ</a>' +
          (/^https?:\/\//i.test(String(st.sourceUrl || ""))
            ? '<a href="' +
              escapeHtml(st.sourceUrl) +
              '" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm">🔗 店舗情報</a>'
            : "") +
          "</div>" +
          '<div class="evidence-panel">' +
          "<p><strong>🔍 お店の特徴・魚料理：</strong>" +
          escapeHtml(st.menuEvidence) +
          "</p>" +
          "<p><strong>🎯 チラシご挨拶〜提案の切り口：</strong>" +
          escapeHtml(st.whyFit) +
          "</p>" +
          '<div class="fish-tag-list">' +
          fishTagsHtml +
          "</div>" +
          "</div>" +
          '<div class="card-script-box">' +
          '<div class="card-script-tabs">' +
          '<button type="button" class="card-script-tab' +
          (stepKey === "call" ? " is-active" : "") +
          '" data-action="switch-step" data-id="' +
          st.id +
          '" data-step="call">① 電話：チラシご挨拶</button>' +
          '<button type="button" class="card-script-tab' +
          (stepKey === "visit1" ? " is-active" : "") +
          '" data-action="switch-step" data-id="' +
          st.id +
          '" data-step="visit1">② 初回訪問：90秒手渡し</button>' +
          '<button type="button" class="card-script-tab' +
          (stepKey === "visit2" ? " is-active" : "") +
          '" data-action="switch-step" data-id="' +
          st.id +
          '" data-step="visit2">③ 再訪：お試し→定期便</button>' +
          "</div>" +
          '<div class="card-script-body">' +
          escapeHtml(activeScript) +
          "</div>" +
          '<div class="card-script-actions">' +
          '<button type="button" class="btn btn-outline btn-sm" data-action="open-teleprompter" data-id="' +
          st.id +
          '">🎤 電話中・大文字カンペ表示</button>' +
          '<button type="button" class="btn btn-navy btn-sm" data-action="copy-script" data-id="' +
          st.id +
          '">📋 このトークをコピー</button>' +
          "</div>" +
          "</div>" +
          '<div class="card-crm-box">' +
          '<div class="crm-controls-row">' +
          '<select class="select-field" data-action="change-status" data-id="' +
          st.id +
          '" aria-label="営業進捗ステータス">' +
          statusOptions +
          "</select>" +
          '<input type="date" class="input-field" data-action="change-date" data-id="' +
          st.id +
          '" value="' +
          escapeHtml(crm.visitDate) +
          '" aria-label="訪問予定日・再架電日" title="訪問予定日・再架電日" />' +
          "</div>" +
          '<textarea class="memo-textarea" data-action="change-memo" data-id="' +
          st.id +
          '" placeholder="✍️ 富田君メモ（大将のお名前・チラシ受取の反応・よく使う魚・手が空く時間帯など自動保存）">' +
          escapeHtml(crm.memo) +
          "</textarea>" +
          "</div>" +
          "</article>"
        );
      })
      .join("");
  }

  // Event Delegation on Stores Grid
  function bindStoresGridDelegation() {
    const grid = document.getElementById("stores-card-grid");
    if (!grid) return;

    grid.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      const id = parseInt(btn.getAttribute("data-id") || "0", 10);
      const store = STORES.find((s) => s.id === id);

      if (action === "copy-phone") {
        copyText(btn.getAttribute("data-phone") || "", "電話番号");
      } else if (action === "toggle-star" && store) {
        const cur = getCrm(id);
        const nextStar = !cur.starred;
        updateCrm(id, { starred: nextStar, routeExcluded: nextStar ? false : cur.routeExcluded });
        renderStoresGrid();
        renderRoutePlanner();
        showToast(
          nextStar
            ? "⭐ 「" + store.name + "」を今日の電車訪問ルートに追加しました"
            : "訪問ルート登録を解除しました"
        );
      } else if (action === "switch-step" && store) {
        const step = btn.getAttribute("data-step") || "call";
        updateCrm(id, { scriptStep: step });
        renderStoresGrid();
      } else if (action === "copy-script" && store) {
        const crm = getCrm(id);
        copyText(getScriptByStep(store, crm.scriptStep), store.name + " のトークスクリプト");
      } else if (action === "open-teleprompter" && store) {
        openTeleprompter(store.id);
      }
    });

    grid.addEventListener("change", (e) => {
      const target = e.target;
      const action = target.getAttribute("data-action");
      const id = parseInt(target.getAttribute("data-id") || "0", 10);
      if (!id) return;

      if (action === "change-status") {
        const val = target.value;
        const patch = { status: val };
        if (val === "チラシ手渡しアポ獲得" || val === "ポスト投函OK") {
          patch.routeExcluded = false;
        }
        updateCrm(id, patch);
        renderRoutePlanner();
        showToast("進捗を「" + val + "」に保存しました");
      } else if (action === "change-date") {
        updateCrm(id, { visitDate: target.value });
        showToast("予定日を保存しました");
      }
    });

    grid.addEventListener("input", (e) => {
      const target = e.target;
      if (target.getAttribute("data-action") === "change-memo") {
        const id = parseInt(target.getAttribute("data-id") || "0", 10);
        if (id) updateCrm(id, { memo: target.value });
      }
    });
  }

  // ==========================================================================
  // Tab 2: Today's Midosuji Train Visit Route Planner
  // ==========================================================================
  function renderRoutePlanner() {
    const container = document.getElementById("route-stations-container");
    const summaryEl = document.getElementById("route-summary-banner");
    const dirBtn = document.getElementById("btn-route-direction");
    if (!container || !summaryEl) return;

    const jst = getJstNow();
    const routeStores = STORES.filter(isRouteStore);

    if (dirBtn) {
      dirBtn.textContent =
        state.routeDirection === "south"
          ? "🔄 並び順：江坂 → 梅田（南行き順）"
          : "🔄 並び順：梅田 → 江坂（北行き帰り順）";
    }

    if (!routeStores.length) {
      summaryEl.innerHTML =
        "<div><strong>📭 現在、訪問ルートに登録された店舗は 0 件です。</strong></div>" +
        "<div>リストで「⭐ 訪問ルートに追加」または進捗「📄 チラシ手渡しアポ獲得！」を選ぶか、右上の「⚡ 初日おすすめ練習ルート」を押してください。</div>";
      container.innerHTML = "";
      return;
    }

    const orderedCodes =
      state.routeDirection === "south" ? STATION_ORDER.slice() : STATION_ORDER.slice().reverse();

    const groups = [];
    let maxFare = 0;
    let closedWarnCount = 0;

    for (const code of orderedCodes) {
      const items = routeStores
        .filter((s) => s.stationCode === code)
        .sort((a, b) => (a.walkMinutes || 5) - (b.walkMinutes || 5));
      if (items.length) {
        const stMeta = STATIONS.find((x) => x.code === code) || { name: code, rideMin: 0, fareYen: 0 };
        if ((stMeta.fareYen || 0) > maxFare) maxFare = stMeta.fareYen || 0;
        items.forEach((it) => {
          if (isLikelyClosedToday(it.closedDay, jst.weekdayJp)) closedWarnCount++;
        });
        groups.push({ code, meta: stMeta, items });
      }
    }

    summaryEl.innerHTML =
      "<div><strong>🚃 本日のチラシ訪問予定：" +
      routeStores.length +
      " 店舗（下車 " +
      groups.length +
      " エリア）</strong>｜江坂からの最遠片道運賃目安：¥" +
      maxFare +
      "（往復 ¥" +
      maxFare * 2 +
      "）</div>" +
      "<div>" +
      (closedWarnCount > 0
        ? '<span class="badge-closed-warn">⚠️ うち ' +
          closedWarnCount +
          " 店舗は本日（" +
          escapeHtml(jst.weekdayJp) +
          "）定休の可能性があります</span>"
        : "✅ 本日定休に該当する注意店舗はありません") +
      "</div>";

    let seq = 1;
    container.innerHTML = groups
      .map((g) => {
        const rideInfo =
          g.meta.rideMin === 0
            ? "拠点徒歩圏（運賃 ¥0）"
            : "江坂駅から御堂筋線 " + g.meta.rideMin + "分（片道 ¥" + g.meta.fareYen + "）";
        const rowsHtml = g.items
          .map((st) => {
            const crm = getCrm(st.id);
            const closed = isLikelyClosedToday(st.closedDay, jst.weekdayJp);
            const mapUrl =
              "https://www.google.com/maps/search/?api=1&query=" +
              encodeURIComponent(st.name + " " + st.address);
            const num = seq++;
            return (
              '<div class="route-stop-item">' +
              '<div class="route-order-num">' +
              num +
              "</div>" +
              "<div>" +
              "<strong>" +
              escapeHtml(st.name) +
              "</strong> " +
              (closed
                ? '<span class="badge-closed-warn">⚠️ 定休確認: ' + escapeHtml(st.closedDay) + "</span>"
                : "") +
              '<div style="font-size:0.8rem; color:var(--ink-secondary);">📍 ' +
              escapeHtml(st.address) +
              "（" +
              escapeHtml(st.stationDetail) +
              "）</div>" +
              '<div style="font-size:0.79rem; color:var(--ink-muted);">訪問推奨: ' +
              escapeHtml(st.visitWindow || st.callWindow) +
              " ／ 魚種: " +
              escapeHtml(st.hookProduct) +
              (crm.memo ? " ／ メモ: " + escapeHtml(crm.memo) : "") +
              "</div>" +
              "</div>" +
              "<div>" +
              '<span style="font-size:0.8rem; font-weight:700;">状態: ' +
              escapeHtml(crm.status) +
              "</span><br />" +
              '<span style="font-family:var(--font-mono); font-size:0.82rem;">' +
              escapeHtml(st.phone) +
              "</span>" +
              "</div>" +
              '<div style="display:flex; gap:6px; flex-wrap:wrap;" class="no-print">' +
              '<a href="' +
              escapeHtml(mapUrl) +
              '" target="_blank" rel="noopener noreferrer" class="btn btn-jade btn-sm">🗺️ 経路</a>' +
              '<button type="button" class="btn btn-outline btn-sm" data-route-done="' +
              st.id +
              '">✅ 訪問済にする</button>' +
              '<button type="button" class="btn btn-outline btn-sm" data-route-remove="' +
              st.id +
              '">解除</button>' +
              "</div>" +
              "</div>"
            );
          })
          .join("");

        return (
          '<div class="route-station-group">' +
          '<div class="route-station-head">' +
          "<strong>🚇 " +
          escapeHtml(g.meta.name) +
          "（" +
          g.items.length +
          "店舗）</strong>" +
          '<span style="font-size:0.8rem;">' +
          escapeHtml(rideInfo) +
          "</span>" +
          "</div>" +
          rowsHtml +
          "</div>"
        );
      })
      .join("");

    container.querySelectorAll("[data-route-done]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = parseInt(btn.getAttribute("data-route-done") || "0", 10);
        updateCrm(id, { status: "1回目チラシ訪問済" });
        renderRoutePlanner();
        renderStoresGrid();
        showToast("👟 「1回目チラシ訪問済」に更新しました！お疲れ様です！");
      });
    });

    container.querySelectorAll("[data-route-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = parseInt(btn.getAttribute("data-route-remove") || "0", 10);
        updateCrm(id, { starred: false, routeExcluded: true });
        renderRoutePlanner();
        renderStoresGrid();
        showToast("本日の訪問ルートから除外しました");
      });
    });
  }

  // ==========================================================================
  // Tab 3 & Tab 4: 4-Stage Funnel Scripts, Objections & Company Bible
  // ==========================================================================
  function renderPlaybookAndCompany() {
    const funnelEl = document.getElementById("funnel-steps-container");
    if (funnelEl) {
      funnelEl.innerHTML = FUNNEL_STAGES.map((st) => {
        const checks = (st.checkPoints || [])
          .map((c) => "<li>" + escapeHtml(c) + "</li>")
          .join("");
        return (
          '<article class="funnel-step-card">' +
          '<span class="funnel-step-badge">' +
          escapeHtml(st.badge) +
          "</span>" +
          '<h3 style="margin:0; font-size:1.05rem;">' +
          escapeHtml(st.title) +
          "</h3>" +
          '<p style="margin:0; font-size:0.84rem; color:var(--ink-secondary);"><strong>🎯 ゴール：</strong>' +
          escapeHtml(st.goal) +
          "</p>" +
          '<p style="margin:0; font-size:0.82rem; color:var(--jade-600);"><strong>💡 心構え：</strong>' +
          escapeHtml(st.keyMindset) +
          "</p>" +
          '<div class="script-quote-box"><strong>【基本トークA】</strong>\n' +
          escapeHtml(st.scriptReception) +
          "</div>" +
          '<div class="script-quote-box"><strong>【展開トークB】</strong>\n' +
          escapeHtml(st.scriptChefDirect) +
          "</div>" +
          '<ul style="margin:0; padding-left:18px; font-size:0.81rem; color:var(--ink-secondary);">' +
          checks +
          "</ul>" +
          "</article>"
        );
      }).join("");
    }

    const objEl = document.getElementById("objection-cards-container");
    if (objEl) {
      objEl.innerHTML = OBJECTIONS.map((ob) => {
        return (
          '<article class="objection-card">' +
          '<p class="objection-trigger">🗣️ ' +
          escapeHtml(ob.trigger) +
          "</p>" +
          '<p style="margin:0 0 8px; font-size:0.8rem; color:var(--ink-muted);">❌ NG対応：' +
          escapeHtml(ob.badMove) +
          "</p>" +
          '<div class="script-quote-box" style="margin-bottom:8px;"><strong>⭕ 富田君の優しい切り返し：</strong>\n' +
          escapeHtml(ob.goodResponse) +
          "</div>" +
          '<p style="margin:0; font-size:0.8rem; color:var(--jade-600);">💡 ' +
          escapeHtml(ob.whyWorks) +
          "</p>" +
          "</article>"
        );
      }).join("");
    }

    const pillarsEl = document.getElementById("company-pillars-grid");
    if (pillarsEl && COMPANY_BIBLE.threePillars) {
      pillarsEl.innerHTML = COMPANY_BIBLE.threePillars
        .map(
          (p) =>
            '<div class="pillar-card">' +
            '<div class="pillar-num">' +
            escapeHtml(p.num) +
            "</div>" +
            '<h3 style="margin:0 0 8px; font-size:1rem;">' +
            escapeHtml(p.title) +
            "</h3>" +
            '<p style="margin:0; font-size:0.85rem; color:var(--ink-secondary);">' +
            escapeHtml(p.desc) +
            "</p>" +
            "</div>"
        )
        .join("");
    }

    const ovTbody = document.getElementById("company-overview-tbody");
    if (ovTbody && COMPANY_BIBLE.overview) {
      ovTbody.innerHTML = COMPANY_BIBLE.overview
        .map(
          (row) =>
            "<tr><th>" +
            escapeHtml(row.label) +
            "</th><td>" +
            escapeHtml(row.value) +
            "</td></tr>"
        )
        .join("");
    }

    const guardEl = document.getElementById("company-guardrails-list");
    if (guardEl && COMPANY_BIBLE.strictGuardrails) {
      guardEl.innerHTML = COMPANY_BIBLE.strictGuardrails
        .map((g) => "<li>" + escapeHtml(g) + "</li>")
        .join("");
    }
  }

  // ==========================================================================
  // Full-Screen Teleprompter Modal (電話中・大文字カンペ)
  // ==========================================================================
  function openTeleprompter(storeId) {
    const store = STORES.find((s) => s.id === storeId);
    const modal = document.getElementById("teleprompter-modal");
    if (!store || !modal) return;

    state.teleprompterStoreId = store.id;
    const crm = getCrm(store.id);
    state.teleprompterStep = crm.scriptStep || "call";

    document.getElementById("tp-station-badge").textContent =
      store.stationGroup + "｜徒歩" + store.walkMinutes + "分";
    document.getElementById("teleprompter-title").textContent = store.name;
    document.getElementById("tp-meta").textContent =
      store.genre + " ／ 定休: " + store.closedDay + " ／ 架電推奨: " + store.callWindow;

    const callBtn = document.getElementById("tp-call-btn");
    callBtn.href = "tel:" + String(store.phone || "").replace(/[^0-9+]/g, "");
    callBtn.textContent = "📞 " + store.phone;

    const statusSel = document.getElementById("tp-status-select");
    statusSel.value = crm.status;
    const memoInp = document.getElementById("tp-memo-input");
    memoInp.value = crm.memo;

    renderTeleprompterStep();

    const quickObjWrap = document.getElementById("tp-quick-objections");
    const ansBox = document.getElementById("tp-objection-answer");
    ansBox.hidden = true;
    quickObjWrap.innerHTML = OBJECTIONS.map(
      (ob) =>
        '<button type="button" class="btn btn-outline btn-sm" data-tp-obj="' +
        escapeHtml(ob.id) +
        '">' +
        escapeHtml(ob.trigger.slice(0, 14)) +
        "…</button>"
    ).join("");

    quickObjWrap.querySelectorAll("[data-tp-obj]").forEach((b) => {
      b.addEventListener("click", () => {
        const ob = OBJECTIONS.find((x) => x.id === b.getAttribute("data-tp-obj"));
        if (!ob) return;
        ansBox.hidden = false;
        ansBox.innerHTML =
          "<strong>" +
          escapeHtml(ob.trigger) +
          "</strong><br />👉 " +
          escapeHtml(ob.goodResponse);
      });
    });

    modal.hidden = false;
  }

  function renderTeleprompterStep() {
    const store = STORES.find((s) => s.id === state.teleprompterStoreId);
    if (!store) return;
    document.querySelectorAll(".tp-step-btn").forEach((b) => {
      b.classList.toggle("is-active", b.getAttribute("data-tp-step") === state.teleprompterStep);
    });
    document.getElementById("tp-script-content").textContent = getScriptByStep(
      store,
      state.teleprompterStep
    );
  }

  function closeTeleprompter() {
    const modal = document.getElementById("teleprompter-modal");
    if (modal) modal.hidden = true;
    renderStoresGrid();
    renderRoutePlanner();
  }

  // ==========================================================================
  // Export CSV & Mobile Share Link & Tab Switching
  // ==========================================================================
  function exportCsv() {
    const headers = [
      "No",
      "ランク",
      "駅エリア",
      "駅徒歩",
      "店舗名",
      "電話番号",
      "住所",
      "業態",
      "定休日",
      "推奨架電時間",
      "提案魚種",
      "進捗ステータス",
      "予定日",
      "訪問ルート登録",
      "富田君メモ"
    ];
    const rows = STORES.map((st) => {
      const crm = getCrm(st.id);
      return [
        st.id,
        st.rank,
        st.stationGroup,
        st.stationDetail,
        st.name,
        st.phone,
        st.address,
        st.genre,
        st.closedDay,
        st.callWindow,
        (st.fishTags || []).join("・"),
        crm.status,
        crm.visitDate,
        crm.starred ? "★" : "",
        crm.memo
      ].map((cell) => {
        let s = String(cell == null ? "" : cell);
        if (/^[=+\-@]/.test(s)) s = "'" + s;
        return '"' + s.replace(/"/g, '""') + '"';
      });
    });

    const csv = "\uFEFF" + [headers.join(",")].concat(rows.map((r) => r.join(","))).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ファインアトラス_御堂筋線_富田架電訪問進捗.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("💾 進捗CSVファイルをダウンロードしました！");
  }

  function shareMobileRouteUrl() {
    const routeIds = STORES.filter(isRouteStore).map((s) => s.id);
    if (!routeIds.length) {
      showToast("先に「☆ 訪問ルートに追加」または「チラシ手渡しアポ獲得」を1店以上選んでください");
      return;
    }
    const base = window.location.href.split("#")[0];
    const shareUrl = base + "#route=" + routeIds.join(",");
    copyText(shareUrl, "スマホ引継ぎ用ルートURL（" + routeIds.length + "店舗）");
  }

  function resetAllFilters() {
    state.station = "ALL";
    state.fish = "ALL";
    state.search = "";
    state.segment = "ALL";
    state.statusFilter = "ALL";
    state.sort = "priority";
    state.quickTags.clear();

    document.getElementById("input-search").value = "";
    document.getElementById("select-segment").value = "ALL";
    document.getElementById("select-status").value = "ALL";
    document.getElementById("select-sort").value = "priority";
    document.querySelectorAll(".pill-toggle").forEach((p) => p.classList.remove("is-active"));

    renderStationTrack();
    renderFishBar();
    renderStoresGrid();
  }

  function switchMainTab(tabName) {
    state.activeTab = tabName;
    const map = {
      list: ["tab-btn-list", "panel-list"],
      route: ["tab-btn-route", "panel-route"],
      scripts: ["tab-btn-scripts", "panel-scripts"],
      company: ["tab-btn-company", "panel-company"],
      flyer: ["tab-btn-flyer", "panel-flyer"],
      visits: ["tab-btn-visits", "panel-visits"]
    };
    Object.keys(map).forEach((k) => {
      const [btnId, panelId] = map[k];
      const btn = document.getElementById(btnId);
      const panel = document.getElementById(panelId);
      const isSelected = k === tabName;
      if (btn) btn.setAttribute("aria-selected", isSelected ? "true" : "false");
      if (panel) panel.hidden = !isSelected;
    });
    if (tabName === "route") {
      renderRoutePlanner();
    }
  }

  // ==========================================================================
  // Init & Event Listeners
  // ==========================================================================
  function initTheme() {
    let saved = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
      if (saved === "dark" || saved === "light") {
        document.documentElement.setAttribute("data-theme", saved);
      }
    } catch (_e) {
      // ignore
    }
    const btn = document.getElementById("btn-theme-toggle");
    if (btn) {
      if (saved === "dark") {
        btn.textContent = "☀️ ライト表示切替";
      }
      btn.addEventListener("click", () => {
        const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
        const next = cur === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch (_e) {
          // ignore
        }
        btn.textContent = next === "dark" ? "☀️ ライト表示切替" : "🌙 ダーク表示切替";
      });
    }
  }

  function initControls() {
    // Primary Tabs
    document.getElementById("tab-btn-list").addEventListener("click", () => switchMainTab("list"));
    document.getElementById("tab-btn-route").addEventListener("click", () => switchMainTab("route"));
    document.getElementById("tab-btn-scripts").addEventListener("click", () => switchMainTab("scripts"));
    document.getElementById("tab-btn-company").addEventListener("click", () => switchMainTab("company"));
    document.getElementById("tab-btn-flyer").addEventListener("click", () => switchMainTab("flyer"));
    document.getElementById("tab-btn-visits").addEventListener("click", () => switchMainTab("visits"));

    // Filter Inputs
    document.getElementById("input-search").addEventListener("input", (e) => {
      state.search = e.target.value;
      renderStoresGrid();
    });
    document.getElementById("select-segment").addEventListener("change", (e) => {
      state.segment = e.target.value;
      renderStoresGrid();
    });
    document.getElementById("select-status").addEventListener("change", (e) => {
      state.statusFilter = e.target.value;
      renderStoresGrid();
    });
    document.getElementById("select-sort").addEventListener("change", (e) => {
      state.sort = e.target.value;
      renderStoresGrid();
    });

    document.querySelectorAll(".pill-toggle").forEach((pill) => {
      pill.addEventListener("click", () => {
        const tag = pill.getAttribute("data-qtag");
        if (!tag) return;
        if (state.quickTags.has(tag)) {
          state.quickTags.delete(tag);
          pill.classList.remove("is-active");
        } else {
          state.quickTags.add(tag);
          pill.classList.add("is-active");
        }
        renderStoresGrid();
      });
    });

    document.getElementById("btn-reset-filters").addEventListener("click", resetAllFilters);
    document.getElementById("btn-export-csv").addEventListener("click", exportCsv);
    document.getElementById("btn-share-mobile-route").addEventListener("click", shareMobileRouteUrl);

    // Route Planner Controls
    document.getElementById("btn-route-direction").addEventListener("click", () => {
      state.routeDirection = state.routeDirection === "south" ? "north" : "south";
      renderRoutePlanner();
    });
    document.getElementById("btn-route-starter").addEventListener("click", () => {
      const starter = STORES.filter(
        (s) => (s.stationCode === "M11" || s.stationCode === "M12") && s.rank === "S"
      ).slice(0, 5);
      starter.forEach((s) => updateCrm(s.id, { starred: true, routeExcluded: false }));
      renderRoutePlanner();
      renderStoresGrid();
      showToast("⚡ 江坂・東三国のSランク5店舗を練習ルートにセットしました！");
    });
    document.getElementById("btn-print-route").addEventListener("click", () => window.print());

    // Step 4 Hearing Sheet Copy
    document.getElementById("btn-copy-hearing-report").addEventListener("click", () => {
      const val = (id) => (document.getElementById(id).value || "（未記入）").trim();
      const report = [
        "【ファインアトラス 定期便ご提案・お見積り相談メモ（担当：富田）】",
        "■ 店舗名・ご担当者：" + val("hear-store"),
        "① 料理の用途：" + val("hear-usage"),
        "② 希望魚種・サイズ・量：" + val("hear-species"),
        "③ 任せたい下処理レベル：" + val("hear-prep"),
        "④ 希望納品状態・曜日・時間：" + val("hear-delivery"),
        "⑤ お試しセット反応・お悩みメモ：" + val("hear-notes"),
        "※価格・最低ロット・送料・配送曜日の個別条件確認をお願いいたします。"
      ].join("\n");
      copyText(report, "5項目ヒアリング報告メモ");
    });

    // Flyer Customization & Print
    document.getElementById("flyer-rep-name").addEventListener("input", (e) => {
      document.getElementById("flyer-preview-rep").textContent = e.target.value;
    });
    document.getElementById("flyer-rep-contact").addEventListener("input", (e) => {
      document.getElementById("flyer-preview-contact").textContent = e.target.value;
    });
    document.getElementById("btn-print-flyer").addEventListener("click", () => window.print());

    // Teleprompter Modal Controls
    document.getElementById("btn-close-teleprompter").addEventListener("click", closeTeleprompter);
    document.getElementById("teleprompter-modal").addEventListener("click", (e) => {
      if (e.target.id === "teleprompter-modal") closeTeleprompter();
    });
    document.querySelectorAll(".tp-step-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.teleprompterStep = b.getAttribute("data-tp-step") || "call";
        if (state.teleprompterStoreId) {
          updateCrm(state.teleprompterStoreId, { scriptStep: state.teleprompterStep });
        }
        renderTeleprompterStep();
      });
    });
    document.getElementById("tp-status-select").addEventListener("change", (e) => {
      if (state.teleprompterStoreId) {
        const val = e.target.value;
        const patch = { status: val };
        if (val === "チラシ手渡しアポ獲得" || val === "ポスト投函OK") {
          patch.routeExcluded = false;
        }
        updateCrm(state.teleprompterStoreId, patch);
        showToast("進捗を「" + val + "」に更新しました");
      }
    });
    document.getElementById("tp-memo-input").addEventListener("input", (e) => {
      if (state.teleprompterStoreId) {
        updateCrm(state.teleprompterStoreId, { memo: e.target.value });
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeTeleprompter();
    });
  }

  function boot() {
    initTheme();
    importRouteFromHash();
    initControls();
    bindStoresGridDelegation();
    renderPlaybookAndCompany();
    renderStationTrack();
    renderFishBar();
    refreshCountersAndKpis();
    renderStoresGrid();
    switchMainTab(state.activeTab);

    setInterval(refreshCountersAndKpis, 30000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
