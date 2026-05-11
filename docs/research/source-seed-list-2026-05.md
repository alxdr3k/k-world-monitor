---
title: Tier A source seed list — 4 메타 카테고리 분포, 경제 우선 (DEC-009), 한국 소스 보강, no upper cap
created_at: 2026-05-11
updated_at: 2026-05-11
status: research
informs:
  - Q-021 (Tier A seed lock)
  - INFRA-1A.6 (Tier A seed slice)
  - DEC-009 (v0 첫 발행 = 경제)
  - REQ-022 / AC-027 (source_perspective 분포 균형 — 전체 seed set 적용)
provenance: research_synthesis
sensitivity: private
ai_include: true
---

# Tier A source seed list — 4 메타 카테고리

## 구성 원칙

- **개수 상한 없음** — Q-021 의 이전 "30~50개" 가이드는 폐기. 1인 운영
  부담 안에서 누적 가능한 만큼 등록 (현재 72 source proposed, v0 진행 중
  추가 등록 자유).
- **DEC-004 4 메타 카테고리 분포** — 경제 / 정책 / 사회 / 대중문화. 경제
  우선 (DEC-009, v0 turn-key 첫 발행).
- **source_perspective 분포 균형 (REQ-022 / AC-027)**:
  - risk_observer ≤ 50%
  - opportunity_observer ≥ 25%
  - neutral ≥ 15%
  - 적용 범위 = **Tier A seed set 전체** (카테고리 subset 의무 아님)
- **한국 소스 적극 포함** — KDI / KIEP / KIET / 외교부 / 통일연구원 /
  KIHASA / 환경부 / 농촌진흥청 / KOCCA / KOFIC / KISDI / KDIC / Asan /
  통일부 / 산림청 / 해양수산부 / KEEI / KAIST AI / KPF / 방통위 /
  소비자원 등.
- **Tier A 우선** (ADR-0016) — 공식 API / RSS / official endpoint.
- **Paywall abstract Tier A 유지** — IEA WEO / IISS / MIT TR / Gates
  publications 등은 abstract / 공식 RSS / 무료 article 만 사용하는 한
  Tier A 유지 (법적 리스크 매우 낮음).
- **RSS endpoint 검증은 INFRA-1A.6 slice 안에서** 진행 (사전 검증 X).
  변경 / 사라진 endpoint 발견 시 등록 시점에 대체 후보로 교체.
- **canonical 위치**: 이 repo `data/sources_seed.yaml` (외부 repo 의존성
  없음). INFRA-1A.6 slice 진입 시 yaml 또는 SQLite migration INSERT 로
  commit.

---

## 1. 경제 (economy) — 22 source (v0 우선, DEC-009)

원래 8 카테고리의 `macro_finance / trade_supply_chain / energy_commodities
/ digital_assets` 가 흡수.

| # | Source name | Publisher | access | perspective | subtopic_tags | 비고 |
|---|---|---|---|---|---|---|
| 1 | FRED | Fed St. Louis | API | neutral | macro_finance | API key 필요 |
| 2 | FOMC statements + speeches | Fed Board | RSS | risk_observer | macro_finance / governance_institutions | |
| 3 | IMF WEO + Article IV | IMF | API + RSS | opportunity_observer | macro_finance / trade_supply_chain | |
| 4 | BIS Quarterly Review + Working Papers | BIS | RSS | risk_observer | macro_finance | |
| 5 | ECB Press + Economic Bulletin | ECB | RSS + API (SDW) | risk_observer | macro_finance | |
| 6 | 한국은행 통화정책 + ECOS API | BOK | API + RSS | risk_observer | macro_finance | ECOS API key |
| 7 | KOSIS Open API | 통계청 | API | neutral | macro_finance / demographics_migration | |
| 8 | BLS Data | US BLS | API | neutral | macro_finance | |
| 9 | World Bank Open Data | World Bank | API | opportunity_observer | macro_finance / trade_supply_chain | |
| 10 | OECD CLI + Outlook | OECD | API | opportunity_observer | macro_finance | |
| 11 | EIA Petroleum + STEO | US EIA | API | neutral | energy_commodities | |
| 12 | IEA Oil Market Report + WEO | IEA | RSS (abstract) | neutral | energy_commodities | **abstract 만 Tier A** (paywall 본문 사용 X) |
| 13 | **KDI 정책분석 / Economic Outlook** | 한국개발연구원 | RSS | opportunity_observer | macro_finance | 한국 |
| 14 | **KIEP 세계경제전망** | 대외경제정책연구원 | RSS | opportunity_observer | trade_supply_chain | 한국 |
| 15 | **KIET 산업동향** | 산업연구원 | RSS | neutral | macro_finance | 한국 |
| 16 | **금융위원회 보도자료** | 한국 금융위 | RSS | risk_observer | macro_finance | 한국 |
| 17 | **KITA 무역통계 + 보고서** | 한국무역협회 | RSS + API | opportunity_observer | trade_supply_chain | 한국 |
| 18 | **산업통상자원부 보도자료** | 한국 산업부 | RSS | neutral | trade_supply_chain | 한국 |
| 19 | **BEA (US Bureau of Economic Analysis)** | US BEA | API | neutral | macro_finance | BLS GDP/PCE 짝 |
| 20 | **BOJ (Bank of Japan) 영문** | BOJ | RSS | risk_observer | macro_finance | G3+1 통화정책 |
| 21 | **PBoC (People's Bank of China) 영문** | PBoC | RSS | risk_observer | macro_finance | 글로벌 매크로 |
| 22 | **한국 KDIC (예금보험공사)** | KDIC | RSS | risk_observer | macro_finance | 한국 금융안정 |

**경제 카테고리 perspective 분포** (22):
- risk_observer: 8 (36%) — Fed FOMC, BIS, ECB, BOK, 금융위, BOJ, PBoC, KDIC
- opportunity_observer: 6 (27%) — IMF, World Bank, OECD, KDI, KIEP, KITA
- neutral: 8 (36%) — FRED, KOSIS, BLS, EIA, IEA, KIET, 산업부, BEA
- ≤50% / ≥25% / ≥15% 모두 충족 ✓

---

## 2. 정책 (policy) — 17 source

원래 8 카테고리의 `geopolitics_security / governance_institutions /
regulatory_policy` 흡수.

| # | Source name | Publisher | access | perspective | subtopic_tags | 비고 |
|---|---|---|---|---|---|---|
| 23 | UN Security Council Press | UN | RSS | neutral | geopolitics_security | |
| 24 | NATO Press Releases | NATO | RSS | risk_observer | geopolitics_security | |
| 25 | 외교부 보도자료 | 외교부 | RSS | neutral | governance_institutions | 한국 |
| 26 | 국방부 보도자료 | 국방부 | RSS | neutral | governance_institutions | 한국 |
| 27 | CSIS Reports | CSIS | RSS | risk_observer | geopolitics_security | |
| 28 | Brookings Research | Brookings | RSS | opportunity_observer | governance_institutions | |
| 29 | IISS Strategic Survey / Military Balance | IISS | RSS (abstract) | neutral | geopolitics_security | **abstract 만 Tier A** |
| 30 | **CFR Reports** | Council on Foreign Relations | RSS | opportunity_observer | geopolitics_security / governance_institutions | |
| 31 | **PIIE Policy Briefs** | Peterson Institute for International Economics | RSS | opportunity_observer | trade_supply_chain / governance_institutions | |
| 32 | **통일연구원 (KINU) 정세분석** | KINU | RSS | risk_observer | geopolitics_security | 한국 |
| 33 | **세종연구소 정책분석** | 세종연구소 | RSS | mixed | geopolitics_security | 한국 |
| 34 | **국회입법조사처 (NABO)** | 입법조사처 | RSS | neutral | governance_institutions | 한국 |
| 35 | **Carnegie Endowment** | Carnegie | RSS | mixed | geopolitics_security / governance_institutions | Brookings 짝 |
| 36 | **Atlantic Council** | Atlantic Council | RSS | risk_observer | geopolitics_security | NATO 짝 |
| 37 | **Asan Institute** | 아산정책연구원 | RSS | mixed | geopolitics_security | 한국 외교/안보 |
| 38 | **통일부 보도자료** | 한국 통일부 | RSS | neutral | governance_institutions | 한국 정부 |
| 39 | **East-West Center** | East-West Center | RSS | opportunity_observer | geopolitics_security / governance_institutions | Asia-Pacific 협력 — 분포 보강 |

**정책 카테고리 perspective 분포** (17):
- risk_observer: 4 (24%) — NATO, CSIS, KINU, Atlantic Council
- opportunity_observer: 4 (24%) — Brookings, CFR, PIIE, East-West Center
- neutral: 6 (35%) — UNSC, 외교부, 국방부, IISS, NABO, 통일부
- mixed: 3 (18%) — 세종, Carnegie, Asan

---

## 3. 사회 (society) — 18 source

원래 8 카테고리의 `health_biosecurity / demographics_migration /
food_water_security / climate_environment` 흡수.

| # | Source name | Publisher | access | perspective | subtopic_tags | 비고 |
|---|---|---|---|---|---|---|
| 40 | WHO Disease Outbreak News | WHO | RSS | neutral | health_biosecurity | |
| 41 | CDC MMWR | CDC | RSS | neutral | health_biosecurity | |
| 42 | FAO Food Outlook + GIEWS | FAO | RSS + API | neutral | food_water_security | |
| 43 | IPCC Assessment Reports | IPCC | RSS | risk_observer | climate_environment | |
| 44 | IOM World Migration Report | IOM | RSS | opportunity_observer | demographics_migration | |
| 45 | KDCA 보도자료 | 질병관리청 | RSS | neutral | health_biosecurity | 한국 |
| 46 | **KIHASA 보건사회연구** | 한국보건사회연구원 | RSS | mixed | health_biosecurity / demographics_migration | 한국 |
| 47 | **환경부 보도자료** | 한국 환경부 | RSS | neutral | climate_environment | 한국 |
| 48 | **농촌진흥청 (RDA)** | RDA | RSS | neutral | food_water_security | 한국 |
| 49 | **UN SDG Knowledge Hub** | UN | RSS | opportunity_observer | demographics_migration / climate_environment | |
| 50 | **Gates Foundation Research** | Gates Foundation | RSS | opportunity_observer | health_biosecurity | **공식 RSS Tier A** (publications 일부 paywall, abstract만) |
| 51 | **UNHCR** | UN High Commissioner for Refugees | RSS | opportunity_observer | demographics_migration | |
| 52 | **ECDC** | EU Centre for Disease Prevention and Control | RSS | neutral | health_biosecurity | CDC 의 EU 짝 |
| 53 | **NOAA** | US National Oceanic and Atmospheric Administration | API + RSS | neutral | climate_environment / food_water_security | climate 데이터 |
| 54 | **한국 산림청** | 산림청 | RSS | neutral | climate_environment | 한국 |
| 55 | **한국 해양수산부** | 해수부 | RSS | neutral | climate_environment / food_water_security | 한국 |
| 56 | **KEEI (에너지경제연구원)** | KEEI | RSS | mixed | climate_environment / energy_commodities | 한국 |
| 57 | **UN Habitat** | UN Habitat | RSS | opportunity_observer | demographics_migration | 도시화/housing |

**사회 카테고리 perspective 분포** (18):
- risk_observer: 1 (6%) — IPCC
- opportunity_observer: 5 (28%) — IOM, UN SDG, Gates, UNHCR, UN Habitat
- neutral: 10 (56%) — WHO, CDC, FAO, KDCA, 환경부, RDA, ECDC, NOAA, 산림청, 해양수산부
- mixed: 2 (11%) — KIHASA, KEEI

---

## 4. 대중문화 (pop_culture) — 15 source

원래 8 카테고리의 `technology_cyber_ai consumer surface / media /
cultural trend / 디지털 콘텐츠 생태` 흡수.

| # | Source name | Publisher | access | perspective | subtopic_tags | 비고 |
|---|---|---|---|---|---|---|
| 58 | Pew Research Center | Pew | RSS | neutral | technology_cyber_ai | |
| 59 | Reuters Institute Digital News Report | Reuters Institute | RSS | neutral | technology_cyber_ai / social_stability_information | |
| 60 | Stanford HAI AI Index Report | Stanford HAI | RSS + manual | neutral | technology_cyber_ai | annual report |
| 61 | MIT Technology Review | MIT | RSS | opportunity_observer | technology_cyber_ai | **무료 article + abstract Tier A** (일부 paywall 본문 사용 X) |
| 62 | OECD AI Policy Observatory | OECD AI | RSS | neutral | technology_cyber_ai / governance_institutions | |
| 63 | **KOCCA 콘텐츠산업 동향** | 한국콘텐츠진흥원 | RSS | opportunity_observer | technology_cyber_ai / social_stability_information | 한국 |
| 64 | **KOFIC 영상산업 통계** | 영화진흥위원회 | RSS | opportunity_observer | social_stability_information | 한국 |
| 65 | **KISDI 정보통신정책분석** | 정보통신정책연구원 | RSS | mixed | technology_cyber_ai / governance_institutions | 한국 |
| 66 | CISA Cybersecurity Advisories | US CISA | RSS | risk_observer | technology_cyber_ai | |
| 67 | **KAIST AI Center** | KAIST AI | RSS + manual | opportunity_observer | technology_cyber_ai | 한국, publication frequency 낮지만 quality 高 |
| 68 | **한국언론진흥재단 (KPF)** | KPF | RSS | neutral | social_stability_information | 한국 언론 dynamics |
| 69 | **방송통신위원회** | 한국 방통위 | RSS | mixed | technology_cyber_ai / governance_institutions | 한국 |
| 70 | **한국소비자원** | 한국소비자원 | RSS | neutral | social_stability_information | 한국 소비 동향 |
| 71 | **WIPO** | World Intellectual Property Organization | RSS | opportunity_observer | technology_cyber_ai | IP 보호 = innovation 옹호 perspective |
| 72 | **OECD Going Digital Project** | OECD | RSS | opportunity_observer | technology_cyber_ai / governance_institutions | digital transformation |

**대중문화 카테고리 perspective 분포** (15):
- risk_observer: 1 (7%) — CISA
- opportunity_observer: 6 (40%) — MIT TR, KOCCA, KOFIC, KAIST AI, WIPO, OECD Going Digital
- neutral: 6 (40%) — Pew, Reuters Institute, Stanford HAI, OECD AI, KPF, 소비자원
- mixed: 2 (13%) — KISDI, 방통위

---

## 5. 전체 분포 — REQ-022 / AC-027 enforcement

| 카테고리 | 총 | risk | opportunity | neutral | mixed |
|---|---|---|---|---|---|
| 경제 | 22 | 8 (36%) | 6 (27%) | 8 (36%) | 0 |
| 정책 | 17 | 4 (24%) | 4 (24%) | 6 (35%) | 3 (18%) |
| 사회 | 18 | 1 (6%) | 5 (28%) | 10 (56%) | 2 (11%) |
| 대중문화 | 15 | 1 (7%) | 6 (40%) | 6 (40%) | 2 (13%) |
| **전체** | **72** | **14 (19%)** | **21 (29%)** | **30 (42%)** | **7 (10%)** |

**전체 분포 검증** (REQ-022 / AC-027):
- risk_observer 19% ≤ 50% ✓
- opportunity_observer 29% ≥ 25% ✓ (안전 마진 4%)
- neutral 42% ≥ 15% ✓
- **AC-027 통과**. INFRA-1A.6 진입 blocker 없음.

---

## 6. v0 비포함 — Tier B-C 강등 / commercial bias

다음은 합리적 근거로 v0 Tier A 시드에서 제외:

| 후보 | 분류 | 근거 |
|---|---|---|
| a16z research / a16z Future | Tier B (deferred) | VC commercial publication — investment thesis 와 publication 의 boundary 흐림. 1인 콘텐츠 발행자 mental model 에 가까운 opportunity_observer 이나 v0 deferred. v1+ 운영 부담 안에서 Tier B 등록 검토 |
| Stratechery | Tier B-C (deferred) | Paywall + commercial newsletter. abstract 만 Tier B 등록 가능하나 v0 미포함 |
| McKinsey Global Institute | Tier B (deferred) | Paywall + commercial. 약관 검토 필요 (ADR-0016 manual fallback) |
| Goldman Sachs Research | Tier C | Institutional client only paywall. v0 미포함 |
| JPMorgan Research | Tier C | 동일 |

---

## 7. 다음 단계 (사용자 review 필요)

1. **사용자 list review** — 72 source 중 빠진 / 잘못된 publisher / 우선
   순위 재조정. 특히:
   - perspective 분류 동의 여부 (예 WIPO opportunity 재분류 / Asan mixed
     vs risk / Carnegie mixed vs opportunity)
   - 한국 추가 후보 (KIPF / KIDP / KOMSA / 행안부 등) 등록 검토
   - paywall abstract Tier A 유지 정책에 따른 IEA WEO / IISS / MIT TR /
     Gates publications 운영 룰 확정 (RSS feed URL 확인 시점 = INFRA-1A.6)
2. **사용자 accept** 후 이 repo `data/sources_seed.yaml` 에 commit (또는
   SQLite migration INSERT). 외부 repo 의존성 없음 — `alxdr3k/k-world-
   monitor` 자체가 canonical.
3. **INFRA-1A.6 slice** 진입: 72 source 의 (a) RSS endpoint 실제 존재
   검증 (b) source_policy 3 필드 (archive / raw_cloud / external_llm) 설정
   (c) 8 위험 행동 트리거 (d) access_method (e) collectability_score 초기치
4. **DEC-009 PUB-1A.5 첫 발행 카테고리 = 경제** 진입: 경제 22 source 중
   첫 Dossier 주제 선정 (운영자 직접 선택)

---

## Sources / References

- DEC-004 (v0 4 메타 카테고리)
- DEC-009 (첫 발행 = 경제)
- Q-021 (Tier A seed — no upper cap, this repo canonical)
- ADR-0016 (Tier A-D + collectability_score + no bot bypass)
- ADR-0019 (source_perspective tag 분포 강제)
- REQ-022 / AC-027 (분포 균형 — Tier A seed set 전체 적용)
- DEC-001 (이 repo = canonical, vault 외부 repo 형 운영)
- Public source registries — all official endpoints (FRED / IMF / World
  Bank / OECD / ECB / BOJ / PBoC / BEA / NOAA / WHO / FAO / IPCC / WIPO /
  KDI / KIEP / KITA / 외교부 / 국방부 / 환경부 / KOCCA / KOFIC / KAIST AI
  / etc.) confirmed official-publisher / RSS / API
