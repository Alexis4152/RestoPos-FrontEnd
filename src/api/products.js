import api from './axios'

/**
 * Lista los productos (de la tienda del usuario), opcionalmente filtrados/paginados.
 * @param {Object} [params] Query params de filtro/paginación (ej. categoría, página).
 * @returns {Promise} Respuesta de axios con el listado de productos.
 */
export const getProducts = (params) => api.get('/products', { params })

/**
 * Busca productos por texto/código (ej. para el buscador del punto de venta o inventario).
 * @param {Object} [params] Query params de búsqueda (ej. `{ q: '...' }`).
 * @returns {Promise} Respuesta de axios con los productos que coinciden con la búsqueda.
 */
export const searchProducts = (params) => api.get('/products/search', { params })

/**
 * Búsqueda paginada de productos para Inventario (metadatos completos de paginación), con
 * los mismos filtros que `searchProducts` (`q`, `categoryId`, `lowStock`) — a diferencia de
 * esta (usada por Menú/Órdenes/Dashboard, devuelve solo un arreglo), pagina en el servidor
 * para que Inventario no tenga que cargar el catálogo completo de un jalón.
 * @param {Object} [params] Query params: `q`, `categoryId`, `lowStock`, `page`, `size`.
 * @returns {Promise} Respuesta de axios con `{content, page, size, totalElements, totalPages}`.
 */
export const getProductsPage = (params) => api.get('/products/page', { params })

/**
 * Busca stock disponible de un producto en las tiendas "hermanas" de la del usuario (las
 * que comparten el mismo Supervisor), sin exponer nada más de ellas — ej. para saber si una
 * sucursal del mismo grupo tiene existencias antes de mandar a un cliente para allá.
 * @param {Object} params Query params: `q` (obligatorio), `page`, `size`.
 * @returns {Promise} Respuesta de axios con `{content, page, size, totalElements, totalPages}`.
 */
export const getSiblingStock = (params) => api.get('/products/sibling-stock', { params })

/**
 * Busca un producto activo por su código de barras EXACTO (pensado para lectores de código
 * de barras en Inventario, a diferencia de `searchProducts` que hace coincidencia parcial).
 * Un código que no exista no es un error: la respuesta llega igual con `data: null`.
 * @param {string} barcode Código de barras exacto a buscar.
 * @returns {Promise} Respuesta de axios con el producto encontrado, o `data: null`.
 */
export const getProductByBarcode = (barcode) => api.get(`/products/by-barcode/${encodeURIComponent(barcode)}`)

/**
 * Obtiene el detalle de un producto por id.
 * @param {number|string} id Id del producto.
 * @returns {Promise} Respuesta de axios con el producto solicitado.
 */
export const getProduct = (id) => api.get(`/products/${id}`)

/**
 * Crea un nuevo producto.
 * @param {Object} data Datos del producto (nombre, precio, categoría, stock, etc.).
 * @returns {Promise} Respuesta de axios con el producto creado.
 */
export const createProduct = (data) => api.post('/products', data)

/**
 * Actualiza un producto existente.
 * @param {number|string} id Id del producto.
 * @param {Object} data Datos a actualizar.
 * @returns {Promise} Respuesta de axios con el producto actualizado.
 */
export const updateProduct = (id, data) => api.put(`/products/${id}`, data)

/**
 * Ajusta manualmente el stock de un producto (ej. entrada/salida de inventario, corrección).
 * @param {number|string} id Id del producto.
 * @param {Object} data Datos del ajuste (ej. cantidad, motivo).
 * @returns {Promise} Respuesta de axios con el producto/stock actualizado.
 */
export const adjustStock = (id, data) => api.post(`/products/${id}/adjust-stock`, data)

/**
 * Elimina un producto.
 * @param {number|string} id Id del producto a eliminar.
 * @returns {Promise} Respuesta de axios confirmando la eliminación.
 */
export const deleteProduct = (id) => api.delete(`/products/${id}`)

/**
 * Sube/reemplaza la foto de un producto. Arma un `FormData` con el archivo y lo
 * envía como `multipart/form-data`.
 * @param {number|string} id Id del producto.
 * @param {File} file Archivo de imagen (PNG/JPEG/WEBP).
 * @returns {Promise} Respuesta de axios con el producto actualizado.
 */
export const uploadProductImage = (id, file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/products/${id}/image`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
}

/**
 * Elimina la foto actual de un producto.
 * @param {number|string} id Id del producto.
 * @returns {Promise} Respuesta de axios con el producto actualizado.
 */
export const removeProductImage = (id) => api.delete(`/products/${id}/image`)

/**
 * Productos más pedidos (con historial primero), para el buscador rápido de la toma de
 * órdenes.
 * @param {Object} [params] `{ categoryId, limit }`, ambos opcionales.
 * @returns {Promise} Respuesta de axios con el listado ordenado.
 */
export const getTopSellingProducts = (params) => api.get('/products/top-selling', { params })

// ── Carga masiva de productos por Excel ────────────────────────────────────────────────

/**
 * Descarga la plantilla (.xlsx) de carga masiva de productos, con las columnas esperadas y
 * una fila de ejemplo. Disponible para ADMIN/SUPER_ADMIN/SUPERVISOR.
 * @returns {Promise} Respuesta de axios con el archivo en `data` (blob).
 */
export const getBulkImportTemplate = () => api.get('/products/bulk-import/template', { responseType: 'blob' })

/**
 * Sube un archivo de carga masiva de productos. Solo SUPER_ADMIN. Crea un producto por
 * cada fila válida y reporta el resto como errores, sin tumbar la carga completa por una
 * sola fila mala — ver `data.errors` (primeros 10) y `data.errorReportBase64` (el Excel
 * completo de errores en base64, solo si hubo más de 10).
 * @param {File} file Archivo .xlsx con el mismo formato que la plantilla.
 * @returns {Promise} Respuesta de axios con el resumen de la carga.
 */
export const bulkImportProducts = (file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/products/bulk-import', form, { headers: { 'Content-Type': 'multipart/form-data' } })
}


/**
 * Marca un platillo como agotado (`disponible = false`) o de nuevo disponible. Lo puede usar
 * el mesero desde la orden, no solo el admin.
 */
export const setProductAvailable = (id, disponible) => api.patch(`/products/${id}/disponible`, { disponible })

/**
 * Modo rápido: `{ opciones: {grupoId: opcionId}, notas: [..] }` — la opción más pedida de cada
 * grupo obligatorio (solo si domina) y las notas que más se escriben para el platillo.
 */
export const getProductSuggestions = (id) => api.get(`/products/${id}/sugerencias`)
