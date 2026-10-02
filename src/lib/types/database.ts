/**
 * Database types for supabase-js, mirroring supabase/migrations.
 * Regenerate with `npm run db:types` once the Supabase CLI is linked to a
 * project; keep this file in sync with the migrations until then.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      categories: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          description?: string;
          sort_order?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["categories"]["Insert"]>;
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string;
          category_id: string;
          price_cents: number;
          currency: string;
          image_url: string | null;
          stock: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          description?: string;
          category_id: string;
          price_cents: number;
          currency?: string;
          image_url?: string | null;
          stock?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["products"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      get_cart: {
        Args: { p_token: string };
        Returns: {
          product_id: string;
          quantity: number;
          slug: string;
          name: string;
          price_cents: number;
          currency: string;
          image_url: string | null;
          stock: number;
          is_active: boolean;
          added_at: string;
        }[];
      };
      add_to_cart: {
        Args: { p_token: string; p_product_id: string; p_quantity?: number };
        Returns: number;
      };
      set_cart_item_quantity: {
        Args: { p_token: string; p_product_id: string; p_quantity: number };
        Returns: number;
      };
      remove_cart_item: {
        Args: { p_token: string; p_product_id: string };
        Returns: undefined;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Category = Database["public"]["Tables"]["categories"]["Row"];
export type Product = Database["public"]["Tables"]["products"]["Row"];
export type ProductWithCategory = Product & { category: Pick<Category, "slug" | "name"> };
export type CartRow = Database["public"]["Functions"]["get_cart"]["Returns"][number];
