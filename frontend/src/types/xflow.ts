/** xflow API type definitions */

export interface Product {
  id: number | string;
  title: string;
  description?: string | null;
  price?: number | null;
  category_id?: number | string | null;
  category?: string | null;
  image_url?: string | null;
  status?: "published" | "draft" | "archived";
  created_at?: string;
  updated_at?: string;
}

export interface Blog {
  id: number | string;
  title: string;
  content?: string | null;
  cover_image?: string | null;
  category_id?: number | string | null;
  category?: string | null;
  status?: "published" | "draft";
  created_at?: string;
  updated_at?: string;
}

export interface Category {
  id: number | string;
  name: string;
  slug?: string | null;
  description?: string | null;
  parent_id?: number | string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Outfit {
  id: number | string;
  title: string;
  description?: string | null;
  image_url?: string | null;
  product_ids?: (number | string)[];
  status?: "published" | "draft";
  created_at?: string;
  updated_at?: string;
}

export interface Video {
  id: number | string;
  title: string;
  description?: string | null;
  url?: string | null;
  thumbnail_url?: string | null;
  status?: "published" | "draft";
  created_at?: string;
  updated_at?: string;
}

export interface DashboardStats {
  products: { total: number; published: number; draft: number };
  blogs: { total: number; published: number; draft: number };
  categories: { total: number };
  outfits: { total: number; published: number; draft: number };
  videos: { total: number; published: number; draft: number };
}

export interface XflowPaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface XflowConfig {
  url: string;
  token: string;
}
