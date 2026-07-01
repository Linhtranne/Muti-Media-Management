# Notion Workspace Spec

## Purpose

Notion được dùng làm **Knowledge & Brief Plane** cho MediaOps Composability. Airtable vẫn là nguồn trạng thái workflow chính; Notion cung cấp ngữ cảnh dài cho con người và AI.

## Workspace Structure

```text
MediaOps Knowledge Hub
├── Campaign Briefs
├── Brand Guidelines
├── Content Guidelines
├── Legal & Compliance Notes
├── Meeting Notes
├── Sprint Reviews
└── Retrospectives
```

## Database: Campaign Briefs

| Field | Type | Required | Notes |
| :--- | :--- | :--- | :--- |
| Campaign Name | Title | Yes | Same campaign name as Airtable |
| Airtable Campaign ID | Text | Yes | Link back to Airtable |
| Campaign Objective | Text | Yes | Goal/KPI |
| Target Audience | Text | Yes | Audience segment |
| Brand Voice | Select/Text | Yes | Tone guidance |
| Key Message | Text | Yes | Core narrative |
| Do Terms | Multi-select/Text | No | Preferred terms |
| Avoid Terms | Multi-select/Text | No | Forbidden/avoid terms |
| Legal Notes | Text | No | Compliance guidance |
| Reference Assets | URL/Files | No | Asset/context links |
| Status | Select | Yes | Draft, Ready, Archived |
| Owner | Person | Yes | Brief owner |

## Page Template: Campaign Brief

```md
# Campaign Brief: [Campaign Name]

## Objective

## Target Audience

## Core Narrative

## Brand Voice

## Key Messages

## Do Terms

## Avoid Terms

## Legal / Compliance Notes

## Reference Assets

## AI Prompt Notes

## Links
- Airtable Campaign:
- Related Posts:
```

## Database: Brand Guidelines

| Field | Type | Required | Notes |
| :--- | :--- | :--- | :--- |
| Guideline Name | Title | Yes | Brand voice, visual, legal |
| Category | Select | Yes | Voice, Visual, Legal, Platform |
| Status | Select | Yes | Active, Draft, Archived |
| Content | Page body | Yes | Long-form guideline |
| Last Reviewed | Date | No | Review date |

## Integration Rules

- Airtable Campaign must contain `Notion Brief URL`.
- AI Orchestrator may read only Notion pages explicitly linked from Airtable or configured allowlist.
- AI Run stores `notion_context_refs`.
- Notion is not used for publish queue, audit log, token, or high-volume inbox.
- No secret/token/API key is allowed in Notion pages.

## MVP Manual Process

1. BA/SMM creates Campaign Brief from template.
2. BA/SMM copies Notion URL into Airtable Campaign.
3. AI Orchestrator reads context in Sprint 2 or uses manual exported context during Sprint 1.
4. Any change to brand/legal guideline that affects output must be logged in Decision Log.
