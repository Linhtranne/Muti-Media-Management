# Tài liệu Yêu cầu Nghiệp vụ (BRD): Giải quyết Khó khăn trong Quản lý Truyền thông Đa kênh

## 1. Tóm tắt Tổng quan Hành pháp (Executive Summary)

Trong bối cảnh tiếp thị hiện đại, khái niệm về một kênh truyền thông độc tôn đã không còn tồn tại. Khách hàng ngày nay tương tác với thương hiệu trong một không gian đa kênh hội tụ (converged media), nơi các điểm chạm trải dài từ mạng xã hội, website đến email. Dữ liệu thực tế chỉ ra rằng các thương hiệu sử dụng từ 3 kênh phối hợp trở lên có thể đạt tỷ lệ mua hàng cao hơn 287% so với chiến lược đơn kênh, đồng thời cải thiện tỷ lệ giữ chân khách hàng lên tới 91%.

Tuy nhiên, việc duy trì sự hiện diện đồng thời trên Facebook, TikTok, YouTube, LinkedIn,... đang tạo ra những điểm nghẽn nghiêm trọng trong khâu vận hành. Các doanh nghiệp đang phải đối mặt với tình trạng thiếu hụt thời gian quản lý, thông điệp thương hiệu bị phân mảnh, và khó khăn trong việc chứng minh Lợi tức Đầu tư (ROI) của các chiến dịch mạng xã hội.

Tài liệu Yêu cầu Nghiệp vụ (BRD) này được biên soạn nhằm phác thảo các mục tiêu, phạm vi và những yêu cầu chức năng/phi chức năng để giải quyết bài toán "Quản lý truyền thông đa kênh". Dựa trên tài liệu này, các nhóm dự án/sinh viên sẽ đóng vai trò là những nhà thiết kế giải pháp (Solution Architects) để tự do đề xuất các phương án kỹ thuật phù hợp nhất — có thể là tự xây dựng một nền tảng SaaS tập trung, ứng dụng các hệ thống đa tác tử (Multi-agent), kết nối các công cụ có sẵn (như Make, Zapier kết hợp API), hoặc đơn giản chỉ cần sử dụng các công cụ AI Agent (Antigravity, Claude, Chat GPT) để kết nối vào MCP để trực tiếp điều khiển.

## 2. Mục tiêu Dự án và Phân tích Nỗi đau Doanh nghiệp (Pain Points)

Dự án này được sinh ra để giải quyết các "nỗi đau" (Pain points) cốt lõi mà các nhà quản lý truyền thông đang gặp phải:

- **Tiêu tốn nguồn lực và thời gian:** Việc phải đăng nhập, xuất bản nội dung và theo dõi bình luận thủ công trên từng nền tảng riêng biệt làm cạn kiệt thời gian của đội ngũ.

- **Khủng hoảng tích hợp dữ liệu và khó khăn khi đo lường:** Dữ liệu tương tác bị kẹt trong các "ốc đảo" của từng nền tảng, khiến việc bóc tách dữ liệu và chứng minh mức độ hiệu quả tài chính (ROI) trở nên bất khả thi.

**Mục tiêu Kinh doanh (Business Objectives):**

1. **Tập trung hóa quy trình làm việc:** Rút ngắn ít nhất 50% thời gian xử lý các tác vụ đăng bài, lập lịch và phê duyệt bằng cách đưa mọi hoạt động về một điểm kiểm soát duy nhất.

2. **Tương tác thời gian thực:** Nâng cao trải nghiệm khách hàng bằng cách quy tụ mọi lượt đề cập (mentions), bình luận và tin nhắn từ tất cả các kênh về một hộp thư chung (Unified Inbox) để phản hồi nhanh chóng.

3. **Chuẩn hóa đo lường ROI:** Cung cấp hệ thống báo cáo phân tích chéo kênh, cho phép liên kết trực tiếp hiệu suất mạng xã hội với các mục tiêu kinh doanh của doanh nghiệp.

## 3. Phạm vi Dự án và Ranh giới Giải pháp (Project Scope)

Phạm vi dự án (Project Scope) xác định rõ những ranh giới của bài toán để các nhóm phát triển tập trung nguồn lực thiết kế giải pháp.

**Nằm trong phạm vi (In-Scope):**

- Giải pháp phải hỗ trợ kết nối và quản lý luồng công việc cho tối thiểu 3 nền tảng phổ biến (ví dụ: Facebook, TikTok, YouTube, hoặc LinkedIn).

- Quản lý vòng đời nội dung: Từ khâu lên ý tưởng, kiểm duyệt (workflow phê duyệt), lập lịch đến xuất bản tự động.

- Giám sát tương tác: Theo dõi và phản hồi tin nhắn/bình luận chéo nền tảng.

- Báo cáo thống kê: Hiển thị các chỉ số hiệu suất (Reach, Engagement, Conversion) trên một bảng điều khiển duy nhất.

**Nằm ngoài phạm vi (Out-of-Scope):**

- Hỗ trợ sản xuất phần cứng, thiết bị quay dựng video cho truyền thông.

- Quản lý các chiến dịch tiếp thị truyền thống (TVC, báo in, sự kiện vật lý).

- *Lưu ý:* Tài liệu này không bắt buộc một công nghệ cụ thể nào (không bắt buộc phải code SaaS hay dùng AI cụ thể). Nhóm dự án hoàn toàn tự quyết định kiến trúc kỹ thuật miễn là thỏa mãn các yêu cầu nghiệp vụ bên dưới.

## 4. Ma trận Các Bên Liên quan (Stakeholders)

Các giải pháp được đề xuất phải phục vụ được kỳ vọng của các nhóm người dùng và các bên liên quan sau :

| Phân loại Bên Liên quan | Vai trò & Trách nhiệm | Nỗi đau hiện tại | Kỳ vọng Giải pháp |
| :--- | :--- | :--- | :--- |
| **Giám đốc Marketing (CMO)** | Người ra quyết định chiến lược, duyệt ngân sách đầu tư. | Không thấy được mối liên hệ giữa chi phí làm mạng xã hội và doanh thu. | Bảng báo cáo ROI rõ ràng, khả năng theo dõi chiến dịch đa kênh toàn cảnh. |
| **Quản lý Mạng xã hội (Social Media Managers)** | Người trực tiếp lên lịch, quản lý nội dung và đội ngũ. | Quá tải vì phải chuyển đổi liên tục giữa các nền tảng, dễ sót bình luận. | Một giao diện làm việc duy nhất, có quy trình duyệt bài nháp minh bạch. |
| **Đội ngũ Phát triển/IT (Solution Architects)** | Người thiết kế, triển khai và bảo trì giải pháp kỹ thuật. | Đau đầu với việc bảo trì các API tích hợp bị thay đổi liên tục từ Facebook, Tiktok. | Giải pháp có tính mở rộng cao, cấu trúc dữ liệu dễ tích hợp (API/Webhooks). |

## 5. Yêu cầu Chức năng (Functional Requirements)

Bất kể nhóm dự án lựa chọn phương án kỹ thuật nào (SaaS, AI workflows, No-code integrations), hệ thống phải đáp ứng các luồng nghiệp vụ sau đây :

- **F.01 - Quản lý và Lập lịch Nội dung Đa kênh:**

  - Hệ thống cho phép người dùng soạn thảo nội dung (văn bản, hình ảnh, video ngắn) và tùy chỉnh định dạng đó cho phù hợp với từng nền tảng đích ngay trên một màn hình soạn thảo.

  - Hệ thống phải có tính năng lập lịch đăng bài tự động (Scheduling) cho các thời điểm trong tương lai.

- **F.02 - Quản lý Tương tác Tập trung (Unified Social Inbox):**

  - Thu thập toàn bộ bình luận (comments), tin nhắn trực tiếp (direct messages) và lượt nhắc đến (mentions) từ các kênh về một luồng duy nhất.

  - Cho phép người dùng phản hồi trực tiếp các tương tác này từ bên trong hệ thống mà không cần mở ứng dụng nền tảng gốc.

- **F.03 - Lắng nghe Mạng xã hội (Social Listening & Analytics):**

  - Thu thập và trực quan hóa các chỉ số tương tác (Engagement rate, Reach, Shares).

  - *Khuyến nghị nâng cao:* Hệ thống có khả năng đánh giá cảm xúc (sentiment analysis) hoặc phát hiện các xu hướng thảo luận để cảnh báo khủng hoảng truyền thông.

## 6. Yêu cầu Phi chức năng (Non-Functional Requirements)

Yêu cầu phi chức năng quy định "chất lượng" của hệ thống được đề xuất :

- **NF.01 - Hiệu suất và Tính khả dụng:** Giải pháp phải hoạt động dựa trên điện toán đám mây (Cloud/SaaS), cho phép người dùng truy cập mọi lúc mọi nơi. Nó phải được tối ưu hóa để có thể hoạt động ổn định ở những điều kiện mạng cơ bản (khuyến nghị tối thiểu 1Mbps cho mỗi tài khoản).

- **NF.02 - Bảo mật và Phân quyền:**

  - Tất cả các tài khoản quản trị tham gia vào hệ thống phải được bảo vệ bằng Xác thực hai yếu tố (2FA) nhằm tránh rủi ro bị chiếm đoạt tài khoản thương hiệu.

  - Phải có cơ chế Phân quyền dựa trên Vai trò (Role-based access control) để đảm bảo nhân viên sáng tạo chỉ có quyền đăng nháp, không có quyền xóa bài trên kênh chính thức.

- **NF.03 - Tính linh hoạt và Khả năng Mở rộng:** Cấu trúc dữ liệu phải được thiết kế để dễ dàng bổ sung thêm các kênh mạng xã hội mới trong tương lai mà không làm phá vỡ kiến trúc gốc của hệ thống.

## 7. Đề bài mở cho việc Thiết kế Giải pháp (Dành cho Sinh viên/Đội ngũ Kỹ thuật)

Dựa trên các ràng buộc nghiệp vụ phía trên, các nhà thiết kế hệ thống được yêu cầu đề xuất một Kiến trúc Giải pháp (Solution Architecture) cụ thể. Một số định hướng tham khảo:

1. **Hướng phát triển SaaS Truyền thống:** Tự xây dựng một ứng dụng Web (NodeJS/Python) sử dụng Graph API của Facebook, Data API của YouTube để kéo và đẩy dữ liệu trực tiếp, xây dựng giao diện thống kê React/Vue, sau đó sử dụng các AI Agent để phân tích

2. **Hướng phát triển Tự động hóa dựa trên AI (AI Agent & Workflow):** Kết nối các AI Agent thông minh với MCP của Facebook, Tiktok, Youtube,... để cấp quyền cho AI truy cập trực tiếp. Viết các skill, workflow để cho AI làm theo nghiệp vụ.

3. **Hướng Tích hợp Hệ sinh thái (Composability):** Thay vì code từ đầu, cấu trúc một giải pháp tích hợp từ các công cụ chuyên biệt (như dùng Airtable làm CMS quản lý lịch đăng, Slack làm kênh thông báo duyệt bài và kết nối chúng qua Webhooks).

*Tiêu chí đánh giá giải pháp sẽ dựa trên khả năng giải quyết triệt để vấn đề phân mảnh, tính ổn định của hệ thống và mức độ tối ưu ngân sách hoạt động.*