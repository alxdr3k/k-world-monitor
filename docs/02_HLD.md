# 02 HLD — High-Level Design

## Overview

시스템의 한 문단 설명.

## Architecture Diagram

```text
[Client] → [API] → [Service] → [DB]
                       ↓
                     [S3]
```

(diagram.md 또는 이미지 링크로 대체 가능)

## Components

| 컴포넌트 | 책임 | 의존성 |
|---|---|---|
|  |  |  |

## Data Model (요약)

| Entity | 주요 필드 | 저장소 |
|---|---|---|
|  |  |  |

세부 스키마는 별도 문서 또는 마이그레이션 파일 참고.

## Key Interfaces

- API endpoints (요약):
- 이벤트/메시지:
- 외부 통합:

## Cross-cutting

- 인증/인가:
- 로깅/관찰성:
- 에러/재시도:
- 보안/프라이버시:

## Trade-offs & Alternatives

주요 구조 결정은 `adr/`로 이동. 여기에는 요약/링크만.

- ADR-0001: ...

## Open Questions

- Q-###: ...

## Related Requirements

- REQ-001 → 컴포넌트 A가 충족.
- NFR-001 → Service 레이어가 담당.
