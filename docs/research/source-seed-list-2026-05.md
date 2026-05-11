---
title: Tier A source seed list 30개 (Q-021 reflow) — 4 메타 카테고리 분포, 경제 우선 (DEC-009)
created_at: 2026-05-11
status: research
informs:
  - Q-021 (Tier A seed reflow lock)
  - INFRA-1A.6 (Tier A seed slice)
  - DEC-009 (v0 첫 발행 = 경제)
  - REQ-022 (source_perspective 분포 균형)
provenance: research_synthesis
sensitivity: private
ai_include: true
---

# Tier A source seed list 30개 — 4 메타 카테고리 분포

## 구성 원칙

- **총 30 source** (Q-021 30~50 범위 lower bound, 1인 운영 부담 통제)
- **DEC-004 4 메타 카테고리 분포**: 경제 12 + 정책 7 + 사회 6 + 대중문화 5
  (DEC-009 경제 우선 weight)
- **source_perspective 분포** (REQ-022 / ADR-0019 INV-0019-5): 카테고리별로
  risk_observer ≤ 50%, opportunity_observer ≥ 25%, neutral ≥ 15% 충족
- **Tier A 우선** (ADR-0016): 공식 API / RSS / official endpoint. 자동 수집
  가능
- **access_method**: API > RSS > sitemap (자동화 친화도)
- **collectability_score** 4 dimension 초기치(0~1): automation_reliability /
  legal_policy_clarity / anti_bot_friction / preferred_mode

---

## 1. 경제 (economy) — 12 source (v0 우선)

원래 8 카테고리의 `macro_finance / trade_supply_chain / energy_commodities
/ digital_assets` 가 흡수된 메타 카테고리. v0 turn-key 첫 발행 카테고리
(DEC-009).

| # | Source name | Publisher | URL root | access_method | source_perspective | reliability_tier | subtopic_tags | 비고 |
|---|---|---|---|---|---|---|---|---|
| 1 | **FRED (Federal Reserve Economic Data)** | Federal Reserve Bank of St. Louis | https://fred.stlouisfed.org | API (FRED API key) | neutral | A | macro_finance | 수만 개 macroeconomic series. 가장 풍부한 timeseries source |
| 2 | **FOMC statements + speeches** | Federal Reserve Board | https://www.federalreserve.gov/feeds/press_all.xml | RSS | risk_observer | A | macro_finance / governance_institutions | Hawkish/dovish stance 신호. 통화정책 risk 채널 |
| 3 | **IMF WEO Database + Article IV** | International Monetary Fund | https://www.imf.org/en/Publications/WEO + API | API + RSS | opportunity_observer | A | macro_finance / trade_supply_chain | 성장 전망 + 회원국 평가. institutional growth-development perspective |
| 4 | **BIS Quarterly Review + Working Papers** | Bank for International Settlements | https://www.bis.org/list/qtrpdf/index.xml | RSS | risk_observer | A | macro_finance | 금융안정성 + cross-border imbalances. 보수적 risk 관점 |
| 5 | **ECB Press Releases + Economic Bulletin** | European Central Bank | https://www.ecb.europa.eu/rss/press.html + API (SDW) | RSS + API | risk_observer | A | macro_finance | 유럽 통화정책 + 금융안정. ECB SDW로 timeseries |
| 6 | **한국은행 통화정책 + ECOS API** | Bank of Korea | http://ecos.bok.or.kr/api | API + RSS | risk_observer | A | macro_finance | 국내 macro + KRW 통화정책. ECOS Open API key 필요 |
| 7 | **KOSIS Open API (한국 통계청)** | 통계청 (Korean Statistical Information Service) | https://kosis.kr/openapi | API | neutral | A | macro_finance / demographics_migration | 국내 통계 hub. CPI/GDP/employment/demographics |
| 8 | **BLS Data (US Bureau of Labor Statistics)** | US BLS | https://api.bls.gov/publicAPI/v2 | API | neutral | A | macro_finance | CPI/PPI/jobs report. US 노동/물가 공식 |
| 9 | **World Bank Open Data API** | World Bank | https://api.worldbank.org/v2 | API | opportunity_observer | A | macro_finance / trade_supply_chain | Global Economic Prospects + WDI. development perspective |
| 10 | **OECD Composite Leading Indicators + Outlook** | OECD | https://stats.oecd.org/SDMX-JSON | API | opportunity_observer | A | macro_finance | 38개 회원국 leading indicators. OECD growth perspective |
| 11 | **EIA Petroleum Status + Short-Term Energy Outlook** | US Energy Information Administration | https://api.eia.gov | API | neutral | A | energy_commodities | 원유/가스 weekly 통계 + 단기 전망 |
| 12 | **IEA Oil Market Report + World Energy Outlook** | International Energy Agency | https://www.iea.org/topics/oil-market-report (subscriptions) | RSS (abstract) | neutral | A | energy_commodities | 글로벌 에너지 + 전환 시나리오. WEO 연 1회 |

**경제 카테고리 perspective 분포**:
- risk_observer: 2(Fed), 4(BIS), 5(ECB), 6(BOK) = **4/12 = 33%** (≤50% ✓)
- opportunity_observer: 3(IMF), 9(World Bank), 10(OECD) = **3/12 = 25%** (≥25% ✓)
- neutral: 1(FRED), 7(KOSIS), 8(BLS), 11(EIA), 12(IEA) = **5/12 = 42%** (≥15% ✓)

3 dimension 모두 충족. 추가 1 source 등록 시 mixed perspective 권고 (예
IGC 곡물 / IGC = neutral / SCMP 무역 mixed) — 12개로 v0 lock, 추가는
누적 시점.

---

## 2. 정책 (policy) — 7 source

원래 8 카테고리의 `geopolitics_security / governance_institutions / tag
`governance_institutions`` 가 흡수된 메타 카테고리.

| # | Source name | Publisher | URL root | access_method | source_perspective | reliability_tier | subtopic_tags |
|---|---|---|---|---|---|---|---|
| 13 | **UN Security Council Press** | United Nations | https://press.un.org/en/feed/category/security-council | RSS | neutral | A | geopolitics_security |
| 14 | **NATO Press Releases** | NATO | https://www.nato.int/cps/en/natohq/feed.htm | RSS | risk_observer | A | geopolitics_security |
| 15 | **외교부 보도자료 (한국)** | 외교부 | https://www.mofa.go.kr (RSS) | RSS | neutral | A | governance_institutions |
| 16 | **국방부 보도자료 (한국)** | 국방부 | https://www.mnd.go.kr (RSS) | RSS | neutral | A | governance_institutions |
| 17 | **CSIS Reports** | Center for Strategic and International Studies | https://www.csis.org/feeds | RSS | risk_observer | A | geopolitics_security |
| 18 | **Brookings Research** | Brookings Institution | https://www.brookings.edu/feed | RSS | opportunity_observer | A | governance_institutions |
| 19 | **IISS Strategic Survey / Military Balance** | International Institute for Strategic Studies | https://www.iiss.org/publications (abstract RSS) | RSS (abstract) | neutral | A | geopolitics_security |

**정책 카테고리 perspective 분포**:
- risk_observer: 14, 17 = 2/7 = 29% (≤50% ✓)
- opportunity_observer: 18 = 1/7 = 14% (≥25% **미달** ⚠️)
- neutral: 13, 15, 16, 19 = 4/7 = 57% (≥15% ✓)

opportunity_observer 미달 — Brookings 1개. 추가 후보: Atlantic Council
research, Council on Foreign Relations(CFR), Carnegie Endowment. v0
누적 시점에 1개 추가 권고.

---

## 3. 사회 (society) — 6 source

원래 8 카테고리의 `health_biosecurity / demographics_migration / food_water_
security / climate_environment` 가 흡수된 메타 카테고리.

| # | Source name | Publisher | URL root | access_method | source_perspective | reliability_tier | subtopic_tags |
|---|---|---|---|---|---|---|---|
| 20 | **WHO Disease Outbreak News** | World Health Organization | https://www.who.int/feeds/entity/csr/don/en/rss.xml | RSS | neutral | A | health_biosecurity |
| 21 | **CDC MMWR (Morbidity & Mortality Weekly Report)** | US Centers for Disease Control | https://www.cdc.gov/mmwr/rss/rss.xml | RSS | neutral | A | health_biosecurity |
| 22 | **FAO Food Outlook + GIEWS** | Food and Agriculture Organization | https://www.fao.org/giews + RSS | RSS + API | neutral | A | food_water_security |
| 23 | **IPCC Assessment Reports** | Intergovernmental Panel on Climate Change | https://www.ipcc.ch/feed | RSS | risk_observer | A | climate_environment |
| 24 | **IOM World Migration Report** | International Organization for Migration | https://publications.iom.int (RSS) | RSS | opportunity_observer | A | demographics_migration |
| 25 | **질병관리청 (한국 KDCA) 보도자료** | KDCA | https://www.kdca.go.kr (RSS) | RSS | neutral | A | health_biosecurity |

**사회 카테고리 perspective 분포**:
- risk_observer: 23 = 1/6 = 17% (≤50% ✓)
- opportunity_observer: 24 = 1/6 = 17% (≥25% **미달** ⚠️)
- neutral: 20, 21, 22, 25 = 4/6 = 67% (≥15% ✓)

opportunity_observer 미달 — IOM 1개. 추가 후보: Gates Foundation health
reports / UN SDG progress reports / clean tech adoption reports.

---

## 4. 대중문화 (pop_culture) — 5 source

원래 8 카테고리의 `technology_cyber_ai consumer surface / media / cultural
trend / 디지털 콘텐츠 생태` 가 흡수된 메타 카테고리. 1인 발행자의 일반적
콘텐츠 영역에 가장 가까움.

| # | Source name | Publisher | URL root | access_method | source_perspective | reliability_tier | subtopic_tags |
|---|---|---|---|---|---|---|---|
| 26 | **Pew Research Center** | Pew Research | https://www.pewresearch.org/feed | RSS | neutral | A | technology_cyber_ai |
| 27 | **Reuters Institute Digital News Report** | Reuters Institute | https://reutersinstitute.politics.ox.ac.uk/our-research (RSS) | RSS | neutral | A | technology_cyber_ai |
| 28 | **Stanford HAI AI Index Report** | Stanford Human-Centered AI | https://hai.stanford.edu/ai-index (annual) | RSS + manual | neutral | A | technology_cyber_ai |
| 29 | **MIT Technology Review** | MIT Tech Review | https://www.technologyreview.com/feed | RSS | opportunity_observer | A | technology_cyber_ai |
| 30 | **OECD AI Policy Observatory** | OECD AI | https://oecd.ai/en (RSS) | RSS | neutral | A | technology_cyber_ai / governance_institutions |

**대중문화 카테고리 perspective 분포**:
- risk_observer: 0/5 = 0% (≤50% ✓)
- opportunity_observer: 29 = 1/5 = 20% (≥25% **미달** ⚠️)
- neutral: 26, 27, 28, 30 = 4/5 = 80% (≥15% ✓)

opportunity_observer 미달 + risk_observer 부재. 추가 후보:
- risk_observer: Wired security, MIT Tech Review의 일부 cybersecurity 섹션
- opportunity_observer: a16z research (Tier B 가능성 — commercial bias 검토),
  Andreessen Horowitz blog

---

## 5. 전체 분포 요약

| 카테고리 | 총 | risk_observer | opportunity_observer | neutral | 분포 충족 |
|---|---|---|---|---|---|
| 경제 | 12 | 4 (33%) | 3 (25%) | 5 (42%) | ✓ 모두 충족 |
| 정책 | 7 | 2 (29%) | 1 (14%) | 4 (57%) | ⚠️ opportunity 미달 |
| 사회 | 6 | 1 (17%) | 1 (17%) | 4 (67%) | ⚠️ opportunity 미달 |
| 대중문화 | 5 | 0 (0%) | 1 (20%) | 4 (80%) | ⚠️ opportunity 미달 / risk 부재 |
| **전체** | **30** | **7 (23%)** | **6 (20%)** | **17 (57%)** | risk ≤50% ✓ / opportunity 25% 경계 / neutral ≥15% ✓ |

**전체 분포**: risk ≤ 50% ✓ / opportunity ≥ 25% **경계 미달 5%** / neutral
≥ 15% ✓.

opportunity_observer 분포 미달은 정책/사회/대중문화 카테고리에서 발생.
경제 카테고리 단독으로는 분포 충족. v0 turn-key 발행이 경제 카테고리이
므로 **v0 진입 자체는 가능**하되, 정책/사회/대중문화 카테고리 누적 시점
에 opportunity_observer source 추가 등록 권고 (예 CFR, IOM 외 다른 글로벌
agency, a16z 검토 등).

---

## 6. 다음 단계 (사용자 review 필요)

1. **사용자 list review** — 30 source 중 빠진 / 잘못된 publisher / 우선
   순위 재조정 의견. 특히:
   - 한국 source 추가 권고? (한국개발연구원 KDI / 한국은행 BOK 외 / 산업
     연구원 KIET / KIEP 등)
   - paywall source (IEA WEO 본문, MIT Tech Review 일부, IISS 본문) 의
     Tier 재평가 (abstract만 사용 시 Tier A 유지 가능, 본문 필요 시 Tier
     B-C)
   - opportunity_observer 분포 미달 fix를 위한 추가 후보 (CFR / Carnegie /
     a16z 검토)
2. **사용자 accept** 후 외부 repo `data/sources_seed.yaml` 또는 SQLite
   migration INSERT 로 commit.
3. **INFRA-1A.6 slice** 진입: 30개 source 의 source_policy 3 필드 (archive
   / raw_cloud / external_llm) + 8 위험 행동 트리거 + access_method 검증
4. **DEC-009 PUB-1A.5 첫 발행 카테고리 = 경제** 진입: 경제 12 source 중
   첫 Dossier 주제 선정 (운영자 판단)

---

## Sources / References

- DEC-004 (v0 4 메타 카테고리)
- DEC-009 (첫 발행 = 경제)
- Q-021 (Tier A seed reflow)
- ADR-0016 (Tier A-D + collectability_score + no bot bypass)
- ADR-0019 (source_perspective tag 분포 강제)
- REQ-022 (source_perspective 분포 균형 강제)
- Anthropic API: not used here (research synthesis from public source registries)
- Public source registries (FRED / IMF / World Bank / OECD / WHO / etc.) — all official endpoints
