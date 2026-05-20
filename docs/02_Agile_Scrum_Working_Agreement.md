# Agile Scrum Working Agreement

## 1. Sprint Cadence

- Sprint 0: chuẩn bị tài liệu, backlog, kiến trúc, base project.
- Sprint phát triển: 2 tuần/sprint.
- Daily meeting: 15 phút đầu ngày.
- Sprint Planning: đầu sprint.
- Backlog Refinement: ít nhất 1 lần/sprint.
- Sprint Review: demo increment cuối sprint.
- Sprint Retrospective: ngay sau Sprint Review.

## 2. Git Flow

- `main`: bản ổn định đã review.
- `develop`: tích hợp tính năng trong sprint.
- `feature/<story-id>-<short-name>`: nhánh cho user story.
- `hotfix/<issue-id>-<short-name>`: nhánh fix lỗi khẩn cấp từ `main`.

Quy trình:

1. Tạo branch từ `develop`.
2. Code theo user story đã đạt Definition of Ready.
3. Tự test và cập nhật Function Logic Register.
4. Tạo Pull Request vào `develop`.
5. Demo cho BA/PM/mentor.
6. Merge `develop` vào `main` sau Sprint Review thành công.

## 3. Definition of Ready

Một backlog item được đưa vào sprint khi có đủ:

- Description rõ mục tiêu nghiệp vụ.
- User Flow chính và luồng lỗi.
- Data Fields liên quan.
- Acceptance Criteria đo được.
- Business Rules rõ điều kiện xử lý.
- Dependency và rủi ro được ghi nhận.

## 4. Definition of Done

Một backlog item được Done khi:

- Code hoàn thành theo AC.
- Unit/integration test chính đã chạy.
- Không còn bug severity high/critical.
- Audit/security rule liên quan được kiểm tra.
- Function Logic Register đã cập nhật.
- PR được review và merge.

## 5. Scrum Artifacts

- Product Backlog: `04_Product_Backlog.md`.
- Sprint Backlog: tạo từ các item trong Product Backlog theo từng sprint.
- Increment: phần mềm hoặc tài liệu có thể review/demo được.
- Function Logic Register: `05_Function_Flow_Logic_Register.md`.

## 6. Reporting

Daily report trả lời:

- Hôm qua đã làm gì?
- Hôm nay sẽ làm gì?
- Có blocker gì?

Sprint Review report:

- Story hoàn thành.
- Story chưa hoàn thành và lý do.
- Demo link hoặc evidence.
- Bug/risk còn lại.
