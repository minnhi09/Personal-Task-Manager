import type { FastifyReply } from 'fastify';

export function badRequest(reply: FastifyReply, message: string, details?: unknown): void {
  reply.code(400).send({ error: { code: 'BAD_REQUEST', message, details } });
}

export function notFound(reply: FastifyReply, message = 'Không tìm thấy dữ liệu.'): void {
  reply.code(404).send({ error: { code: 'NOT_FOUND', message } });
}

export function conflict(reply: FastifyReply, message = 'Dữ liệu đã được thay đổi ở nơi khác. Hãy tải lại trước khi lưu.'): void {
  reply.code(409).send({ error: { code: 'VERSION_CONFLICT', message } });
}

export function internalError(reply: FastifyReply): void {
  reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Đã xảy ra lỗi máy chủ.' } });
}
