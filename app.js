const KAKAO_JAVASCRIPT_KEY = "80997111825554ef64ddb0481b4c0a76";

const SOURCES = {
  mapUnified: {
    id: "11Nc9gTyWYFoylb-mzhG1cjU0Jy4SSq0-p8cXd3Wbp_0",
    sheet: "지도_통합",
    headerRow: 1,
    endColumn: "O",
  },
};

const SEOUL_CENTER = { lat: 37.5796, lng: 126.977 };
const GEO_CACHE_KEY = "barrierFreeGeoCache.v2";

const state = {
  shops: [],
  filtered: [],
  markers: new Map(),
  geocodeCache: loadGeoCache(),
  filter: "all",
  search: "",
  region: "",
  category: "",
  geocodeRunId: 0,
  geocodeTimer: null,
};

const mapState = {
  provider: "",
  kakaoMap: null,
  kakaoGeocoder: null,
};

const elements = {
  refreshButton: document.querySelector("#refreshButton"),
  exportButton: document.querySelector("#exportButton"),
  searchInput: document.querySelector("#searchInput"),
  regionSelect: document.querySelector("#regionSelect"),
  categorySelect: document.querySelector("#categorySelect"),
  shopList: document.querySelector("#shopList"),
  shopTemplate: document.querySelector("#shopTemplate"),
  mapNote: document.querySelector("#mapNote"),
  visibleCount: document.querySelector("#visibleCount"),
  totalCount: document.querySelector("#totalCount"),
  rampCount: document.querySelector("#rampCount"),
  brailleCount: document.querySelector("#brailleCount"),
  bothCount: document.querySelector("#bothCount"),
  filterButtons: document.querySelectorAll("[data-filter]"),
};

document.querySelectorAll(".segment").forEach((button) => {
  button.addEventListener("click", () => setFilter(button.dataset.filter));
});

document.querySelectorAll(".stat-card").forEach((button) => {
  button.addEventListener("click", () => setFilter(button.dataset.filter));
});

elements.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value.trim().toLowerCase();
  render();
  scheduleGeocode();
});

elements.regionSelect.addEventListener("change", (event) => {
  state.region = event.target.value;
  render();
  scheduleGeocode();
});

elements.categorySelect.addEventListener("change", (event) => {
  state.category = event.target.value;
  render();
  scheduleGeocode();
});

elements.refreshButton.addEventListener("click", () => loadData(true));
elements.exportButton.addEventListener("click", exportCsv);

initMap().finally(() => loadData());

function setFilter(filter) {
  state.filter = filter || "all";
  elements.filterButtons.forEach((button) => {
    const isActive = button.dataset.filter === state.filter;
    button.classList.toggle("active", isActive);
    if (button.classList.contains("stat-card")) {
      button.setAttribute("aria-pressed", String(isActive));
    }
  });
  render();
  scheduleGeocode();
}

async function initMap() {
  if (!KAKAO_JAVASCRIPT_KEY) {
    elements.mapNote.textContent = "카카오 JavaScript 키가 없습니다.";
    return;
  }

  try {
    elements.mapNote.textContent = "카카오 지도를 불러오는 중입니다.";
    await initKakaoMap();
  } catch (error) {
    console.error(error);
    elements.mapNote.textContent = error.message;
  }
}

function initKakaoMap() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      reject(new Error(`카카오 지도 응답 시간이 초과되었습니다. 등록 도메인과 현재 주소(${window.location.origin})를 확인해주세요.`));
    }, 8000);

    const fail = (error) => {
      window.clearTimeout(timeout);
      reject(error);
    };

    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(KAKAO_JAVASCRIPT_KEY)}&libraries=services&autoload=false`;
    script.onload = () => {
      try {
        if (!window.kakao?.maps) {
          fail(new Error(`카카오 지도 인증에 실패했습니다. 카카오 개발자 콘솔의 Web 도메인에 ${window.location.origin} 이 등록되어 있는지 확인해주세요.`));
          return;
        }

        kakao.maps.load(() => {
          window.clearTimeout(timeout);
          const center = new kakao.maps.LatLng(SEOUL_CENTER.lat, SEOUL_CENTER.lng);
          mapState.kakaoMap = new kakao.maps.Map(document.querySelector("#map"), {
            center,
            level: 5,
          });
          mapState.kakaoGeocoder = new kakao.maps.services.Geocoder();
          mapState.provider = "kakao";
          resolve();
        });
      } catch (error) {
        fail(error);
      }
    };
    script.onerror = () => fail(new Error(`카카오 지도 SDK를 불러오지 못했습니다. 등록 도메인과 현재 주소(${window.location.origin})를 확인해주세요.`));
    document.head.append(script);
  });
}

async function loadData(forceRefresh = false) {
  elements.mapNote.textContent = "Google Sheets 데이터를 불러오는 중입니다.";
  if (forceRefresh) {
    state.geocodeCache = loadGeoCache();
  }

  try {
    const unifiedRows = await readSheet(SOURCES.mapUnified);
    state.shops = rowsFromUnifiedMap(unifiedRows);
    hydrateFilterOptions();
    render();

    if (state.shops.length === 0) {
      elements.mapNote.textContent = "시트는 읽었지만 공개 지도에 표시할 행이 없습니다. 지도_통합 탭의 상태가 '공개 가능'인지 확인해주세요.";
      return;
    }

    scheduleGeocode();
  } catch (error) {
    console.error(error);
    elements.mapNote.textContent = `시트를 불러오지 못했습니다. ${error.message}`;
  }
}

function readSheet(source) {
  const query = encodeURIComponent("select *");
  const sheet = encodeURIComponent(source.sheet);
  const range = encodeURIComponent(`A${source.headerRow}:${source.endColumn}`);
  const callback = `sheetCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const url = `https://docs.google.com/spreadsheets/d/${source.id}/gviz/tq?tqx=out:json;responseHandler:${callback}&headers=1&sheet=${sheet}&range=${range}&tq=${query}`;

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Google Sheets 응답 시간이 초과되었습니다: ${source.sheet}`));
    }, 12000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      script.remove();
      delete window[callback];
    };

    window[callback] = (response) => {
      cleanup();
      if (response.status !== "ok") {
        const sheetError = response.errors?.[0]?.detailed_message || response.errors?.[0]?.message || `Sheet load failed: ${source.sheet}`;
        reject(new Error(sheetError));
        return;
      }
      resolve(rowsFromTable(response.table));
    };

    script.src = url;
    script.onerror = () => {
      cleanup();
      reject(new Error(`시트 접근에 실패했습니다: ${source.sheet}`));
    };
    document.head.append(script);
  });
}

function rowsFromTable(table) {
  const headers = table.cols.map((column, index) => cleanHeader(column.label || `열${index + 1}`));
  return table.rows
    .map((row) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = row.c[index]?.f ?? row.c[index]?.v ?? "";
      });
      return record;
    })
    .filter((record) => record["상호명"] || record["주소"]);
}

function rowsFromUnifiedMap(rows) {
  const byKey = new Map();

  rows.filter(isUsableMapRow).forEach((row) => {
    const key = `${normalizeText(row["상호명"])}|${normalizeAddress(row["주소"])}`;
    const existing = byKey.get(key);
    const next = {
      id: key,
      name: row["상호명"] || "이름 없음",
      category: row["업종"] || "",
      address: row["주소"] || "",
      region: row["지역"] || "",
      ramp: row["경사로"] === "Y",
      braille: row["점자메뉴판"] === "Y",
      rampYear: normalizeYear(row["경사로 설치연도"]),
      brailleYear: normalizeYear(row["점자 보급연도"]),
      statusLabel: row["상태"] || "공개 가능",
      lat: Number(row["위도"]) || null,
      lng: Number(row["경도"]) || null,
      publicMemo: row["공개 메모"] || "",
      sourceTypes: [row["원본 구분"]].filter(Boolean),
    };

    if (!existing) {
      next.status = unifiedStatus(next.statusLabel);
      byKey.set(key, next);
      return;
    }

    existing.ramp ||= next.ramp;
    existing.braille ||= next.braille;
    existing.rampYear = latestYear(existing.rampYear, next.rampYear);
    existing.brailleYear = latestYear(existing.brailleYear, next.brailleYear);
    existing.address = preferredAddress(existing.address, next.address);
    existing.lat ||= next.lat;
    existing.lng ||= next.lng;
    existing.publicMemo = joinUnique([existing.publicMemo, next.publicMemo]);
    existing.sourceTypes = unique([...existing.sourceTypes, ...next.sourceTypes]);
  });

  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

function unifiedStatus(value) {
  if (value === "확인 제외/비공개") return "removed";
  if (value === "확인 필요") return "attention";
  return "active";
}

function isUsableMapRow(row) {
  const values = Object.values(row).map((value) => String(value || ""));
  const hasError = values.some((value) => value.startsWith("#"));
  const isPublic = row["상태"] === "공개 가능";
  return Boolean(row["상호명"] && row["주소"] && isPublic && !hasError);
}

function hydrateFilterOptions() {
  const currentRegion = elements.regionSelect.value;
  const currentCategory = elements.categorySelect.value;
  const regions = [...new Set(state.shops.map((shop) => shop.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  const categories = [...new Set(state.shops.map((shop) => shop.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));

  elements.regionSelect.innerHTML = '<option value="">전체 지역</option>';
  regions.forEach((region) => {
    const option = document.createElement("option");
    option.value = region;
    option.textContent = region;
    elements.regionSelect.append(option);
  });
  elements.regionSelect.value = currentRegion;

  elements.categorySelect.innerHTML = '<option value="">전체 업종</option>';
  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    elements.categorySelect.append(option);
  });
  elements.categorySelect.value = currentCategory;
}

function render() {
  state.filtered = state.shops.filter(matchesFilters);
  renderStats();
  renderList();
  renderMarkers();
}

function matchesFilters(shop) {
  const typeMatch =
    state.filter === "all" ||
    (state.filter === "ramp" && shop.ramp) ||
    (state.filter === "braille" && shop.braille) ||
    (state.filter === "both" && shop.ramp && shop.braille);
  return typeMatch && matchesContextFilters(shop);
}

function matchesContextFilters(shop) {
  const haystack = [shop.name, shop.address, shop.region, shop.category].join(" ").toLowerCase();
  const searchMatch = !state.search || haystack.includes(state.search);
  const regionMatch = !state.region || shop.region === state.region;
  const categoryMatch = !state.category || shop.category === state.category;
  return searchMatch && regionMatch && categoryMatch;
}

function renderStats() {
  const contextShops = state.shops.filter(matchesContextFilters);
  elements.totalCount.textContent = contextShops.length.toLocaleString("ko-KR");
  elements.rampCount.textContent = contextShops.filter((shop) => shop.ramp).length.toLocaleString("ko-KR");
  elements.brailleCount.textContent = contextShops.filter((shop) => shop.braille).length.toLocaleString("ko-KR");
  elements.bothCount.textContent = contextShops.filter((shop) => shop.ramp && shop.braille).length.toLocaleString("ko-KR");
  elements.visibleCount.textContent = `${state.filtered.length.toLocaleString("ko-KR")}곳`;
}

function renderList() {
  elements.shopList.innerHTML = "";
  const fragment = document.createDocumentFragment();

  if (state.filtered.length === 0) {
    elements.shopList.innerHTML = '<p class="empty-list">조건에 맞는 가게가 없습니다.</p>';
    return;
  }

  state.filtered.forEach((shop) => {
    const node = elements.shopTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".shop-name").textContent = shop.name;
    node.querySelector(".shop-address").textContent = [shop.category, shop.region, shop.address].filter(Boolean).join(" · ");
    node.querySelector(".shop-tags").append(...tagNodes(shop));
    node.querySelector(".shop-detail").innerHTML = detailHtml(shop);
    node.querySelector(".shop-main").addEventListener("click", () => {
      node.classList.toggle("open");
      focusShop(shop);
    });
    fragment.append(node);
  });

  elements.shopList.append(fragment);
}

function renderMarkers() {
  const visibleIds = new Set(state.filtered.map((shop) => shop.id));

  for (const [id, marker] of state.markers) {
    if (!visibleIds.has(id)) {
      removeMarker(marker);
      state.markers.delete(id);
    }
  }

  state.filtered.forEach((shop) => {
    if (!shop.lat || !shop.lng || state.markers.has(shop.id)) return;
    state.markers.set(shop.id, createMarker(shop));
  });
}

function createMarker(shop) {
  if (mapState.provider === "kakao") {
    const position = new kakao.maps.LatLng(shop.lat, shop.lng);
    const markerNode = markerElement(shop);
    const marker = new kakao.maps.CustomOverlay({
      map: mapState.kakaoMap,
      position,
      content: markerNode,
      yAnchor: 1,
    });
    const infowindow = new kakao.maps.InfoWindow({ content: popupHtml(shop) });
    markerNode.addEventListener("click", () => infowindow.open(mapState.kakaoMap, marker));
    return { marker, infowindow };
  }
  return null;
}

function removeMarker(marker) {
  if (mapState.provider === "kakao") {
    marker.infowindow.close();
    marker.marker.setMap(null);
  }
}

async function geocodeVisibleShops() {
  const runId = ++state.geocodeRunId;
  const queue = state.filtered.filter((shop) => !shop.lat && shop.address).slice(0, 120);
  let completed = 0;

  if (queue.length === 0) {
    updateMapNote();
    return;
  }

  for (const shop of queue) {
    if (runId !== state.geocodeRunId) return;
    const cacheKey = `${mapState.provider}:${shop.address}`;
    const cached = state.geocodeCache[cacheKey];
    if (cached) {
      Object.assign(shop, cached);
    } else {
      const result = await geocode(shop.address);
      if (result) {
        shop.lat = result.lat;
        shop.lng = result.lng;
        state.geocodeCache[cacheKey] = result;
        saveGeoCache(state.geocodeCache);
      }
    }
    completed += 1;
    elements.mapNote.textContent = `주소 좌표를 확인하는 중입니다. ${completed}/${queue.length}`;
    renderMarkers();
  }

  updateMapNote();
}

async function geocode(address) {
  if (mapState.provider === "kakao") {
    return geocodeWithKakao(address);
  }
  return null;
}

function geocodeWithKakao(address) {
  // 서울 종로구 prefix 보장
  let fullAddress = address;
  if (!address.includes("종로구")) fullAddress = "서울 종로구 " + address.replace(/^서울특별시\s*|^서울시\s*|^서울\s*/, "").replace(/^종로구\s*/, "");
  return new Promise((resolve) => {
    mapState.kakaoGeocoder.addressSearch(fullAddress, (result, status) => {
      if (status !== kakao.maps.services.Status.OK || !result[0]) {
        resolve(null);
        return;
      }
      resolve({ lat: Number(result[0].y), lng: Number(result[0].x) });
    });
  });
}

function updateMapNote() {
  const located = state.filtered.filter((shop) => shop.lat && shop.lng);
  fitMapToVisibleMarkers(located);
  const missing = state.filtered.length - located.length;
  const providerLabel = mapState.provider === "kakao" ? "카카오 지도" : "카카오 지도 미연결";
  elements.mapNote.textContent = missing > 0
    ? `${providerLabel} 표시 ${located.length}곳 · 주소 확인 필요 ${missing}곳`
    : `${providerLabel} 표시 ${located.length}곳`;
}

function fitMapToVisibleMarkers(located) {
  if (located.length === 0) return;
  if (mapState.provider === "kakao") {
    const bounds = new kakao.maps.LatLngBounds();
    located.forEach((shop) => bounds.extend(new kakao.maps.LatLng(shop.lat, shop.lng)));
    mapState.kakaoMap.setBounds(bounds);
  }
}

function focusShop(shop) {
  const marker = state.markers.get(shop.id);
  if (!marker) return;
  if (mapState.provider === "kakao") {
    const position = marker.marker.getPosition();
    mapState.kakaoMap.setLevel(3);
    mapState.kakaoMap.setCenter(position);
    marker.infowindow.open(mapState.kakaoMap, marker.marker);
  }
}

function tagNodes(shop) {
  const tags = [];
  if (shop.ramp) tags.push(["경사로", "ramp"]);
  if (shop.braille) tags.push(["점자메뉴판", "braille"]);
  return tags.map(([label, className]) => {
    const node = document.createElement("span");
    node.className = `tag ${className}`;
    node.textContent = label;
    return node;
  });
}

function detailHtml(shop) {
  return [
    rowHtml("이용 가능", serviceLabel(shop)),
    rowHtml("안내", publicGuideMemo(shop.publicMemo)),
  ].filter(Boolean).join("");
}

function markerElement(shop) {
  const button = document.createElement("button");
  button.className = `map-marker ${markerClass(shop)}`;
  button.type = "button";
  button.setAttribute("aria-label", shop.name);
  return button;
}

function popupHtml(shop) {
  return `
    <div class="popup-title">${escapeHtml(shop.name)}</div>
    <div style="font-size:12px;color:#637083;margin-bottom:4px">${escapeHtml(shop.category)} · ${escapeHtml(shop.region)}</div>
    <div style="font-size:12px;margin-bottom:6px">${escapeHtml(shop.address)}</div>
    <div>${tagNodes(shop).map((node) => node.outerHTML).join(" ")}</div>
  `;
}

function rowHtml(label, value) {
  if (!value) return "";
  return `<p><strong>${escapeHtml(label)}</strong> ${escapeHtml(value)}</p>`;
}

function serviceLabel(shop) {
  if (shop.ramp && shop.braille) return "경사로, 점자메뉴판";
  if (shop.ramp) return "경사로";
  if (shop.braille) return "점자메뉴판";
  return "";
}

function publicGuideMemo(value) {
  const memo = String(value || "").trim();
  if (!memo) return "";
  if (/보급 상점|설치 건|설치 이력|기존 보급/i.test(memo)) return "";
  return memo;
}

function markerClass(shop) {
  if (shop.ramp && shop.braille) return "both";
  if (shop.braille) return "braille";
  return "ramp";
}

function exportCsv() {
  const headers = ["상호명", "업종", "주소", "지역", "경사로", "점자메뉴판", "공개상태", "위도", "경도"];
  const rows = state.filtered.map((shop) => [
    shop.name, shop.category, shop.address, shop.region,
    shop.ramp ? "Y" : "", shop.braille ? "Y" : "",
    shop.statusLabel, shop.lat || "", shop.lng || "",
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "barrier-free-shops.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function scheduleGeocode() {
  window.clearTimeout(state.geocodeTimer);
  state.geocodeTimer = window.setTimeout(() => geocodeVisibleShops(), 250);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function normalizeAddress(value) {
  return String(value || "")
    .replace(/\([^)]*\)/g, "")
    .replace(/^서울특별시\s*/, "").replace(/^서울시\s*/, "").replace(/^서울\s*/, "")
    .replace(/^종로구\s*/, "")
    .replace(/\s+/g, " ").trim().toLowerCase();
}

function preferredAddress(current, next) {
  if (!current) return next || "";
  if (!next) return current;
  return current.length >= next.length ? current : next;
}

function cleanHeader(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeYear(value) {
  const match = String(value || "").match(/20\d{2}/);
  return match ? Number(match[0]) : null;
}

function latestYear(current, next) {
  if (!current) return next || null;
  if (!next) return current;
  return Math.max(current, next);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[char]);
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function joinUnique(values) {
  return unique(values.filter(Boolean)).join(" / ");
}

function unique(values) {
  return [...new Set(values)];
}

function loadGeoCache() {
  try { return JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || "{}"); }
  catch { return {}; }
}

function saveGeoCache(cache) {
  localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache));
}
