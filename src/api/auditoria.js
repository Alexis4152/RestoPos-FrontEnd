import api from './axios'

/** Lista la bitácora de auditoría (paginada). Solo ADMIN/SUPER_ADMIN. */
export const getAuditLog = (params) => api.get('/audit', { params })
