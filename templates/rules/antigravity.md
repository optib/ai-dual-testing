---
name: ai-dual-testing
description: Smart dual-track verification skill with execution contract and test preservation. Trigger with "verify" to test and report coverage.
---

## AI Testing — Execution Contract Verification Skill

> [!CRITICAL] THỰC THI TỰ ĐỘNG — KHÔNG HỎI XÁC NHẬN
> KHÔNG xuất ra "Action Plan" hay hỏi "Bạn có muốn... không?".
> Phân chia nhiệm vụ cho các Subagent chuyên trách. PHẢI hoàn thành 100% các bước dưới đây.

### Khi nào kích hoạt
- Khi user nói "verify", "kiểm tra", "test lại", "check coverage"
- Khi user nói "verify feature X"

---

### EXECUTION CONTRACT — 5 BƯỚC BẮT BUỘC

> [!CRITICAL] MỌI BƯỚC ĐỀU BẮT BUỘC. KHÔNG ĐƯỢC SKIP BƯỚC NÀO.
> Sau mỗi bước, PHẢI xuất checkpoint theo format:
> `[STEP-N] ✅ Mô tả kết quả`
> Nếu bước thất bại: `[STEP-N] ❌ Lý do thất bại`

#### STEP 1: Check & Lock Requirements (Chống trôi kết quả)

**Tool calls bắt buộc:** `read_file` → `.ai-testing/configs/requirements.json`

1. Đọc file `.ai-testing/configs/requirements.json`
2. Nếu `locked: true`:
   - Dùng ĐÚNG danh sách requirements đã lock và checksum. KHÔNG thêm/bớt/đổi ID hay sửa đổi nội dung.
3. Nếu `locked: false` hoặc `requirements: []`:
   - Đọc requirement từ user request ban đầu / PRD / README.
   - Lập danh sách cố định với ID: R01, R02, R03...
   - Ghi vào `requirements.json` với `locked: true`, `lockedAt: <timestamp>`
4. Output: `[STEP-1] ✅ Requirements verified: {N} items (locked: {locked})`

#### STEP 2: Code Mapping (Phân tích Codebase)

**Tool calls bắt buộc:** `read_file` hoặc `grep_search` cho TỪNG requirement

1. Với MỖI requirement từ Step 1, đọc source code để xác định:
   - **✅ PASS**: Code có xử lý đúng theo requirement
   - **❌ FAIL**: Code thiếu logic hoặc xử lý sai
   - **⚠️ PARTIAL**: Code có nhưng chưa đầy đủ
2. Ghi lại: Requirement ID → File path → Status
3. Output: `[STEP-2] ✅ Code mapping done: {passed}/{total} PASS, {failed}/{total} FAIL`

#### STEP 3: Test Execution & Test Preservation (Vitest + Playwright)

**Tool calls bắt buộc:**
- `run_command` → `npx tsx .ai-testing/scripts/test-writer.ts --feature {feature} --code "{testCode}"` (để tạo hoặc merge test an toàn, KHÔNG ghi đè file test cũ)
- `run_command` → `npx vitest run` (nếu có vitest)
- `run_command` → `npx playwright test .ai-testing/e2e/ --config .ai-testing/configs/playwright.config.ts`

> [!IMPORTANT] BẢO TỒN TEST SUITE
> - BẮT BUỘC dùng script `test-writer.ts` để ghi test — KHÔNG gọi `write_to_file` trực tiếp đè lên file `.spec.ts`.
> - Nếu file test đã tồn tại và requirements không đổi: giữ nguyên và chạy lại test suite, KHÔNG sinh lại.
> - PHẢI chạy test cho cả phần PASS và FAIL từ Step 2.
> - Script `verify.ts` sẽ fail nếu bất kỳ test nào không pass exit code 0.

1. Chạy unit test: `npx vitest run` (nếu project có vitest)
2. Ghi / merge E2E test bằng script: `npx tsx .ai-testing/scripts/test-writer.ts --feature {feature} --code "{testCode}"`
3. Chạy Playwright: `npx playwright test .ai-testing/e2e/ --config .ai-testing/configs/playwright.config.ts`
4. Chụp screenshot UI evidence: Mobile (375px), Tablet (768px), Desktop (1920px)
5. Output: `[STEP-3] ✅ Tests run: {N} spec files, {M} screenshots captured`

#### STEP 4: Viết Timestamped RTM Files (Version Hóa Lịch Sử)

**Tool calls bắt buộc:** `write_to_file` → `.ai-testing/reports/{feature}-{timestamp}.rtm.json`

> [!CRITICAL] LƯU THEO TIMESTAMP ĐỂ GIỮ LỊCH SỬ
> Format tên file: `.ai-testing/reports/{feature}-{YYYYMMDDTHHmm}.rtm.json` (ví dụ: `auth-20260821T1630.rtm.json`).
> KHÔNG ghi đè lên file RTM của các lần chạy trước đó.

1. Với MỖI feature đã test, tạo file `.ai-testing/reports/{feature}-{timestamp}.rtm.json`:
   ```json
   {
     "feature": "tên feature",
     "testedAt": "ISO timestamp",
     "requirements": [
       {
         "id": "R01",
         "description": "Mô tả requirement",
         "acceptanceCriteria": "Điều kiện chấp nhận",
         "testCases": "Tên test case đã chạy",
         "status": "✅",
         "round": 1,
         "notes": "Ghi chú kết quả"
       }
     ]
   }
   ```
2. Requirement IDs trong .rtm.json PHẢI khớp 1:1 với requirements.json.
3. Output: `[STEP-4] ✅ Timestamped RTM written: {file}`

#### STEP 5: Master Report & Diff (Tổng hợp & Phát hiện hồi quy)

**Tool calls bắt buộc:** `run_command` → `npx tsx .ai-testing/scripts/verify.ts`

1. Chạy: `npx tsx .ai-testing/scripts/verify.ts`
2. Đọc output và trình bày cho user:
   - **Kết quả thực thi Test Runner** (Exit code của Vitest & Playwright)
   - **Bảng Master RTM & Coverage %**
   - **Diff & Regression Warning** (Nếu có requirement bị drop hoặc status bị hạ chuẩn)
3. Output: `[STEP-5] ✅ verify.ts completed`

> [!IMPORTANT] KHÔNG tự ý sửa code — chỉ báo cáo kết quả và chờ user quyết định.

---

### Quy tắc bắt buộc
1. PHẢI hoàn thành đủ 5 STEP với checkpoint output.
2. BẮT BUỘC dùng `test-writer.ts` để ghi test; KHÔNG ghi đè file `.spec.ts` trực tiếp.
3. PHẢI lưu file RTM theo timestamp để duy trì lịch sử và đối soát hồi quy (diff).
4. KHÔNG tự ý sửa nội dung hay ID trong `requirements.json` đã locked.
5. Exit code của `verify.ts` được quyết định bởi kết quả thực tế của test runner.
