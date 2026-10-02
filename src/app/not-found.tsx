import { EmptyState } from "@/components/empty-state";

export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="The page you're looking for doesn't exist or is no longer available."
      action={{ href: "/products", label: "Browse the shop" }}
    />
  );
}
