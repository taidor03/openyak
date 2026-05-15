/** xflow API client — reads config from localStorage via use-xflow-config */

import type {
  Blog,
  Category,
  DashboardStats,
  Outfit,
  Product,
  Video,
  XflowConfig,
  XflowPaginatedResponse,
} from "@/types/xflow";

const XFLOW_CONFIG_KEY = "xflow-config";

export function getXflowConfig(): XflowConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(XFLOW_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<XflowConfig>;
    if (parsed.url && parsed.token) return parsed as XflowConfig;
  } catch {
    // ignore parse errors
  }
  return null;
}

export function setXflowConfig(config: XflowConfig): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(XFLOW_CONFIG_KEY, JSON.stringify(config));
}

export function clearXflowConfig(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(XFLOW_CONFIG_KEY);
}

function buildHeaders(config: XflowConfig): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.token}`,
  };
}

async function xflowFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = getXflowConfig();
  if (!config?.url || !config?.token) {
    throw new Error("xflow API 未配置，请先在设置中填写 URL 和 Token");
  }
  const url = `${config.url.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...buildHeaders(config), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`xflow API 错误 ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// --- Products ---
export const listProducts = (params?: {
  page?: number;
  page_size?: number;
  search?: string;
}) =>
  xflowFetch<XflowPaginatedResponse<Product>>(
    `/api/products?page=${params?.page ?? 1}&page_size=${params?.page_size ?? 20}${params?.search ? `&search=${encodeURIComponent(params.search)}` : ""}`,
  );

export const getProduct = (id: number | string) =>
  xflowFetch<Product>(`/api/products/${id}`);

export const createProduct = (data: Partial<Product>) =>
  xflowFetch<Product>("/api/products", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateProduct = (id: number | string, data: Partial<Product>) =>
  xflowFetch<Product>(`/api/products/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const deleteProduct = (id: number | string) =>
  xflowFetch<void>(`/api/products/${id}`, { method: "DELETE" });

// --- Blogs ---
export const listBlogs = (params?: { page?: number; page_size?: number }) =>
  xflowFetch<XflowPaginatedResponse<Blog>>(
    `/api/blogs?page=${params?.page ?? 1}&page_size=${params?.page_size ?? 20}`,
  );

export const getBlog = (id: number | string) =>
  xflowFetch<Blog>(`/api/blogs/${id}`);

export const createBlog = (data: Partial<Blog>) =>
  xflowFetch<Blog>("/api/blogs", { method: "POST", body: JSON.stringify(data) });

export const updateBlog = (id: number | string, data: Partial<Blog>) =>
  xflowFetch<Blog>(`/api/blogs/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const deleteBlog = (id: number | string) =>
  xflowFetch<void>(`/api/blogs/${id}`, { method: "DELETE" });

// --- Categories ---
export const listCategories = (params?: { page?: number; page_size?: number }) =>
  xflowFetch<XflowPaginatedResponse<Category>>(
    `/api/categories?page=${params?.page ?? 1}&page_size=${params?.page_size ?? 50}`,
  );

export const getCategory = (id: number | string) =>
  xflowFetch<Category>(`/api/categories/${id}`);

export const createCategory = (data: Partial<Category>) =>
  xflowFetch<Category>("/api/categories", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateCategory = (id: number | string, data: Partial<Category>) =>
  xflowFetch<Category>(`/api/categories/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const deleteCategory = (id: number | string) =>
  xflowFetch<void>(`/api/categories/${id}`, { method: "DELETE" });

// --- Outfits ---
export const listOutfits = (params?: { page?: number; page_size?: number }) =>
  xflowFetch<XflowPaginatedResponse<Outfit>>(
    `/api/outfits?page=${params?.page ?? 1}&page_size=${params?.page_size ?? 20}`,
  );

export const createOutfit = (data: Partial<Outfit>) =>
  xflowFetch<Outfit>("/api/outfits", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateOutfit = (id: number | string, data: Partial<Outfit>) =>
  xflowFetch<Outfit>(`/api/outfits/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const deleteOutfit = (id: number | string) =>
  xflowFetch<void>(`/api/outfits/${id}`, { method: "DELETE" });

// --- Videos ---
export const listVideos = (params?: { page?: number; page_size?: number }) =>
  xflowFetch<XflowPaginatedResponse<Video>>(
    `/api/videos?page=${params?.page ?? 1}&page_size=${params?.page_size ?? 20}`,
  );

export const createVideo = (data: Partial<Video>) =>
  xflowFetch<Video>("/api/videos", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateVideo = (id: number | string, data: Partial<Video>) =>
  xflowFetch<Video>(`/api/videos/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const deleteVideo = (id: number | string) =>
  xflowFetch<void>(`/api/videos/${id}`, { method: "DELETE" });

// --- Dashboard ---
export const getDashboardStats = () =>
  xflowFetch<DashboardStats>("/api/dashboard/stats");

// --- Connection test ---
export const testXflowConnection = async (
  url: string,
  token: string,
): Promise<{ ok: boolean; message: string }> => {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/health`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return { ok: true, message: "连接成功" };
    return { ok: false, message: `连接失败: HTTP ${res.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `连接失败: ${msg}` };
  }
};
