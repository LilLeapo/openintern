# File and Image Attachments with Vision Support

## Goal

Enable users to upload files and images in chat, with proper vision/multimodal support so that LLMs can actually "see" and understand image content.

## Background

The previous implementation (commit 2e78fe5) only stored files locally and passed text descriptions to the model. Images were not actually sent to the LLM, so the model couldn't understand image content. This implementation will properly support vision capabilities across all providers.

## Requirements

### 1. File Upload & Storage

- [ ] Users can upload files via:
  - File picker button
  - Drag and drop
  - Paste from clipboard (images only)
- [ ] Support file types:
  - Images: PNG, JPEG, WebP, GIF
  - Text files: TXT, MD, JSON, etc.
  - Other files: PDF, etc. (stored but not sent to LLM)
- [ ] Files stored locally in `uploads/` directory with:
  - Unique upload ID
  - Original filename preserved
  - MIME type recorded
  - Scope-based access control (org/user/project)
- [ ] Max file size: 8MB per file
- [ ] Max attachments per message: 5 files

### 2. Vision Support (Images)

- [ ] Images sent to LLM as base64-encoded content
- [ ] Support all three providers:
  - **OpenAI**: `content: [{ type: "image_url", image_url: { url: "data:..." } }]`
  - **Anthropic**: `content: [{ type: "image", source: { type: "base64", media_type, data } }]`
  - **Gemini**: `parts: [{ inlineData: { mimeType, data } }]`
- [ ] Images included inline in message content (not as separate attachments)
- [ ] Image token counting for budget tracking

### 3. Text File Support

- [ ] Text files (TXT, MD, JSON, etc.) extracted and included as text content
- [ ] Preview first 2000 characters in UI
- [ ] Full content sent to LLM as text

### 4. Frontend UI

- [ ] File upload button in ChatInput
- [ ] Drag-and-drop overlay
- [ ] Paste handler for images
- [ ] Attachment preview chips showing:
  - Filename
  - File size
  - Thumbnail for images
  - Remove button
- [ ] Image thumbnails in chat messages
- [ ] File download links for non-image attachments

### 5. Backend API

- [ ] `POST /api/uploads` - Upload file, returns upload_id
- [ ] `GET /api/uploads/:upload_id` - Download file
- [ ] `POST /api/runs` - Accept attachments array in request body
- [ ] Attachment references resolved before creating run
- [ ] Files converted to appropriate format for each LLM provider

### 6. Type System Changes

- [ ] Extend `Message.content` from `string` to `string | ContentPart[]`
- [ ] Define `ContentPart` types:
  - `{ type: 'text', text: string }`
  - `{ type: 'image', image: { data: string, mimeType: string } }`
- [ ] Update all LLM clients to handle multipart content
- [ ] Update context manager to handle multipart content
- [ ] Update token counter for image tokens

## Acceptance Criteria

### Core Functionality
- [ ] User can upload an image and the LLM can describe what's in it
- [ ] User can upload a text file and the LLM can read its contents
- [ ] Multiple files can be attached to a single message
- [ ] Attachments are scoped to user/org/project (no cross-user access)

### Provider Support
- [ ] Vision works with OpenAI (GPT-4o, GPT-4-turbo)
- [ ] Vision works with Anthropic (Claude 3+)
- [ ] Vision works with Gemini (Gemini 1.5+)

### UI/UX
- [ ] File upload is intuitive (button + drag-drop + paste)
- [ ] Image thumbnails display correctly
- [ ] File size and type validation with clear error messages
- [ ] Attachment preview shows before sending

### Quality
- [ ] All existing tests pass
- [ ] New tests for upload service, API endpoints, and LLM clients
- [ ] No TypeScript errors
- [ ] No lint errors

## Technical Notes

### Architecture

Follow the layered architecture pattern:

1. **Types Layer** (`src/types/`)
   - Define `ContentPart` types
   - Extend `Message` type
   - Add `UploadRecord` and `UploadReference` types

2. **Backend Service Layer** (`src/backend/runtime/`)
   - `UploadService` - File storage and retrieval
   - Update `ContextManager` - Handle multipart content

3. **Backend API Layer** (`src/backend/api/`)
   - `uploads.ts` - Upload/download endpoints
   - Update `runs.ts` - Accept attachments in run creation

4. **LLM Client Layer** (`src/backend/agent/`)
   - Update `anthropic-client.ts` - Map to Anthropic content blocks
   - Update `openai-client.ts` - Map to OpenAI content array
   - Update `gemini-client.ts` - Map to Gemini parts
   - Update `token-counter.ts` - Count image tokens

5. **Frontend API Client** (`web/src/api/`)
   - Add `uploadAttachment()` method
   - Update `createRun()` to accept attachments

6. **Frontend Hook** (`web/src/hooks/`)
   - Update `useChat` to handle file uploads

7. **Frontend Components** (`web/src/components/Chat/`)
   - Update `ChatInput` - File picker, drag-drop, paste
   - Update `ChatMessage` - Render attachments
   - Add `AttachmentPreview` component

### Security Considerations

- Validate file types and sizes on both frontend and backend
- Sanitize filenames to prevent path traversal
- Scope-based access control (no cross-user file access)
- Base64 validation to prevent injection attacks

### Performance Considerations

- Image compression/resizing on frontend before upload (optional)
- Lazy loading of image thumbnails
- Token budget warnings for large images
- Limit number of attachments per message

## Out of Scope

- Cloud storage (S3, etc.) - files stored locally only
- Image editing or cropping
- Video or audio attachments
- OCR for images (LLM vision handles this)
- Attachment search or indexing

## References

- Research Agent analysis: See task directory
- Previous implementation: Commit 2e78fe5 (reverted)
- OpenAI Vision API: https://platform.openai.com/docs/guides/vision
- Anthropic Vision API: https://docs.anthropic.com/claude/docs/vision
- Gemini Multimodal API: https://ai.google.dev/gemini-api/docs/vision
