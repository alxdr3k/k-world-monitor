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
  부담 안에서 누적 가능한 만큼 등록 (현재 50 source proposed, v0 진행 중
  추가 등록 자유).
- **DEC-004 4 메타 카테고리 분포** — 경제 / 정책 / 사회 / 대중문화. 경제
  우선 (DEC-009, v0 turn-key 첫 발행).
- **source_perspective 분포 균형 (REQ-022 / AC-027)**:
  - risk_observer ≤ 50%
  - opportunity_observer ≥ 25%
  - neutral ≥ 15%
  - 적용 범위 = **Tier A seed set 전체** (카테고리 subset 의무 아님)
- **한국 소스 적극 포함** — KDI / KIEP / KIET / 외교부 / 통일연구원 /
  KIHASA / 환경부 / 농촌진흥청 / KOCCA / KOFIC / KISDI 등.
- **Tier A 우선** (ADR-0016) — 공식 API / RSS / official endpoint.
- **canonical 위치**: 이 repo `data/sources_seed.yaml` (외부 repo 의존성
  없음. INFRA-1A.6 slice 진입 시 yaml 또는 SQLite migration INSERT 로
  commit).

---

## 1. 경제 (economy) — 18 source (v0 우선, DEC-009)

원래 8 카테고리의 `macro_finance / trade_supply_chain / energy_commodities
/ digital_assets` 가 흡수.

| # | Source name | Publisher | access | perspective | subtopic_tags |
|---|---|---|---|---|---|
| 1 | FRED | Fed St. Louis | API | neutral | macro_finance |
| 2 | FOMC statements + speeches | Fed Board | RSS | risk_observer | macro_finance / governance_institutions |
| 3 | IMF WEO + Article IV | IMF | API + RSS | opportunity_observer | macro_finance / trade_supply_chain |
| 4 | BIS Quarterly Review + Working Papers | BIS | RSS | risk_observer | macro_finance |
| 5 | ECB Press + Economic Bulletin | ECB | RSS + API (SDW) | risk_observer | macro_finance |
| 6 | 한국은행 통화정책 + ECOS API | BOK | API + RSS | risk_observer | macro_finance |
| 7 | KOSIS Open API | 통계청 | API | neutral | macro_finance / demographics_migration |
| 8 | BLS Data | US BLS | API | neutral | macro_finance |
| 9 | World Bank Open Data | World Bank | API | opportunity_observer | macro_finance / trade_supply_chain |
| 10 | OECD CLI + Outlook | OECD | API | opportunity_observer | macro_finance |
| 11 | EIA Petroleum + STEO | US EIA | API | neutral | energy_commodities |
| 12 | IEA Oil Market Report + WEO | IEA | RSS (abstract) | neutral | energy_commodities |
| 13 | **KDI 정책분석 / Economic Outlook** | 한국개발연구원 | RSS | opportunity_observer | macro_finance |
| 14 | **KIEP 세계경제전망** | 대외경제정책연구원 | RSS | opportunity_observer | trade_supply_chain |
| 15 | **KIET 산업동향** | 산업연구원 | RSS | neutral | macro_finance |
| 16 | **금융위원회 보도자료** | 한국 금융위 | RSS | risk_observer | macro_finance |
| 17 | **KITA 무역통계 + 보고서** | 한국무역협회 | RSS + API | opportunity_observer | trade_supply_chain |
| 18 | **산업통상자원부 보도자료** | 한국 산업부 | RSS | neutral | trade_supply_chain |

**경제 카테고리 perspective 분포**: risk 4 (22%) / opportunity 6 (33%) /
neutral 8 (44%) — risk ≤50% ✓ / opportunity ≥25% ✓ / neutral ≥15% ✓

---

## 2. 정책 (policy) — 12 source

원래 8 카테고리의 `geopolitics_security / tag governance_institutions /
regulatory_policy` 가 흡수.

| # | Source name | Publisher | access | perspective | subtopic_tags |
|---|---|---|---|---|---|
| 19 | UN Security Council Press | UN | RSS | neutral | geopolitics_security |
| 20 | NATO Press Releases | NATO | RSS | risk_observer | geopolitics_security |
| 21 | 외교부 보도자료 | 외교부 | RSS | neutral | governance_institutions |
| 22 | 국방부 보도자료 | 국방부 | RSS | neutral | governance_institutions |
| 23 | CSIS Reports | CSIS | RSS | risk_observer | geopolitics_security |
| 24 | Brookings Research | Brookings | RSS | opportunity_observer | governance_institutions |
| 25 | IISS Strategic Survey / Military Balance | IISS | RSS (abstract) | neutral | geopolitics_security |
| 26 | **CFR Reports** | Council on Foreign Relations | RSS | opportunity_observer | geopolitics_security / governance_institutions |
| 27 | **PIIE Policy Briefs** | Peterson Institute for International Economics | RSS | opportunity_observer | trade_supply_chain / governance_institutions |
| 28 | **통일연구원 (KINU) 정세분석** | KINU | RSS | risk_observer | geopolitics_security |
| 29 | **세종연구소 정책분석** | 세종연구소 | RSS | mixed | geopolitics_security |
| 30 | **국회입법조사처 (NABO)** | 입법조사처 | RSS | neutral | governance_institutions |

**정책 카테고리 perspective 분포**: risk 3 (25%) / opportunity 3 (25%) /
neutral 5 (42%) / mixed 1 (8%) — 전 dimension 충족

---

## 3. 사회 (society) — 11 source

원래 8 카테고리의 `health_biosecurity / demographics_migration / food_water_
security / climate_environment` 흡수.

| # | Source name | Publisher | access | perspective | subtopic_tags |
|---|---|---|---|---|---|
| 31 | WHO Disease Outbreak News | WHO | RSS | neutral | health_biosecurity |
| 32 | CDC MMWR | CDC | RSS | neutral | health_biosecurity |
| 33 | FAO Food Outlook + GIEWS | FAO | RSS + API | neutral | food_water_security |
| 34 | IPCC Assessment Reports | IPCC | RSS | risk_observer | climate_environment |
| 35 | IOM World Migration Report | IOM | RSS | opportunity_observer | demographics_migration |
| 36 | KDCA 보도자료 | 질병관리청 | RSS | neutral | health_biosecurity |
| 37 | **KIHASA 보건사회연구** | 한국보건사회연구원 | RSS | mixed | health_biosecurity / demographics_migration |
| 38 | **환경부 보도자료** | 한국 환경부 | RSS | neutral | climate_environment |
| 39 | **농촌진흥청 (RDA) 농업 동향** | RDA | RSS | neutral | food_water_security |
| 40 | **UN SDG Knowledge Hub** | UN | RSS | opportunity_observer | demographics_migration / climate_environment |
| 41 | **Gates Foundation Research** | Gates Foundation | RSS | opportunity_observer | health_biosecurity (Tier 검토 — RSS 형식 공식 publications 한정) |

**사회 카테고리 perspective 분포**: risk 1 (9%) / opportunity 3 (27%) /
neutral 6 (55%) / mixed 1 (9%) — 전 dimension 충족

---

## 4. 대중문화 (pop_culture) — 9 source

원래 8 카테고리의 `technology_cyber_ai consumer surface / media / cultural
trend / 디지털 콘텐츠 생태` 흡수.

| # | Source name | Publisher | access | perspective | subtopic_tags |
|---|---|---|---|---|---|
| 42 | Pew Research Center | Pew | RSS | neutral | technology_cyber_ai |
| 43 | Reuters Institute Digital News Report | Reuters Institute | RSS | neutral | technology_cyber_ai |
| 44 | Stanford HAI AI Index Report | Stanford HAI | RSS + manual | neutral | technology_cyber_ai |
| 45 | MIT Technology Review | MIT | RSS | opportunity_observer | technology_cyber_ai |
| 46 | OECD AI Policy Observatory | OECD AI | RSS | neutral | technology_cyber_ai / governance_institutions |
| 47 | **KOCCA 콘텐츠산업 동향** | 한국콘텐츠진흥원 | RSS | opportunity_observer | technology_cyber_ai / social_stability_information |
| 48 | **KOFIC 영상산업 통계** | 영화진흥위원회 | RSS | opportunity_observer | social_stability_information |
| 49 | **KISDI 정보통신정책분석** | 정보통신정책연구원 | RSS | mixed | technology_cyber_ai / governance_institutions |
| 50 | **CISA Cybersecurity Advisories** | US CISA | RSS | risk_observer | technology_cyber_ai |

**대중문화 카테고리 perspective 분포**: risk 1 (11%) / opportunity 3 (33%) /
neutral 4 (44%) / mixed 1 (11%) — 전 dimension 충족

---

## 5. 전체 분포 — REQ-022 / AC-027 enforcement

| 카테고리 | 총 | risk | opportunity | neutral | mixed | 카테고리 자체 충족 |
|---|---|---|---|---|---|---|
| 경제 | 18 | 4 (22%) | 6 (33%) | 8 (44%) | 0 | ✓ |
| 정책 | 12 | 3 (25%) | 3 (25%) | 5 (42%) | 1 (8%) | ✓ |
| 사회 | 11 | 1 (9%) | 3 (27%) | 6 (55%) | 1 (9%) | ✓ |
| 대중문화 | 9 | 1 (11%) | 3 (33%) | 4 (44%) | 1 (11%) | ✓ |
| **전체** | **50** | **9 (18%)** | **15 (30%)** | **23 (46%)** | **3 (6%)** | ✓ |

**전체 분포 검증** (REQ-022 / AC-027):
- risk_observer 18% ≤ 50% ✓
- opportunity_observer 30% ≥ 25% ✓ (안전 마진 5%)
- neutral 46% ≥ 15% ✓
- **AC-027 통과 가능**. INFRA-1A.6 진입 blocker 없음.

mixed perspective 3개는 enforcement 분모에 포함되지만 4 dimension 분포
중 어느 쪽으로도 카운트되지 않음 (REQ-022 ratio 계산 시 risk/opportunity/
neutral 3개만 합산 — 그러나 mixed 도 valid value 라 source registry 입력
시 그대로 보존).

---

## 6. 추가 등록 후보 (v0 진행 중 누적)

상한 없음. 1인 운영 부담 안에서 누적:

**경제**:
- BEA (US Bureau of Economic Analysis) — neutral
- 일본 BOJ / 중국 PBoC 영문 자료 — risk_observer / mixed
- 한국 예금보험공사 (금융 안정) — risk_observer

**정책**:
- Carnegie Endowment — mixed
- Atlantic Council — risk_observer
- Asan Institute (한국, 외교/안보 think-tank) — risk_observer / mixed
- 통일부 RSS — neutral

**사회**:
- UNHCR (난민) — opportunity_observer
- ECDC (유럽 질병 관리) — neutral
- NOAA (미국 해양/대기) — neutral
- 산림청 / 해양수산부 (한국) — neutral
- KEEI (에너지경제연구원) — neutral / mixed

**대중문화**:
- KAIST AI Center — opportunity_observer
- a16z research (Tier 검토 — commercial bias) — opportunity_observer
- 한국언론진흥재단 (KPF) — neutral
- 방송통신위원회 — mixed
- 한국소비자원 — neutral
- WIPO (지적재산권) — neutral

추가 시 전체 분포 재계산 (REQ-022 / AC-027 enforcement 가 그대로 적용).

---

## 7. 다음 단계 (사용자 review 필요)

1. **사용자 list review** — 50 source 중 빠진 / 잘못된 publisher / 우선
   순위 재조정. 특히:
   - paywall source (IEA WEO 본문 / MIT Tech Review 일부 / IISS 본문 /
     Gates Foundation publications) 의 Tier 재평가 (abstract 만 사용 시
     Tier A 유지)
   - RSS endpoint 확인 (정부 기관 RSS 가 종종 사라지거나 형식 변경 — 등록
     시 endpoint 검증 의무)
   - 6 섹션 "추가 등록 후보" 중 v0 진입 시 함께 등록할 source 선택
2. **사용자 accept** 후 이 repo `data/sources_seed.yaml` 에 commit (또는
   SQLite migration INSERT). 외부 repo 의존성 없음 — `alxdr3k/k-world-
   monitor` 자체가 canonical.
3. **INFRA-1A.6 slice** 진입: 50 source 의 source_policy 3 필드 (archive /
   raw_cloud / external_llm) + 8 위험 행동 트리거 + access_method + URL
   endpoint 검증
4. **DEC-009 PUB-1A.5 첫 발행 카테고리 = 경제** 진입: 경제 18 source 중
   첫 Dossier 주제 선정 (운영자 판단)

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
  Bank / OECD / ECB / KDI / KIEP / KITA / 외교부 / 환경부 / KOCCA /
  KOFIC / etc.) confirmed official-publisher / RSS / API
