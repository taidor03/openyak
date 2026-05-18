import { EditProductClient } from "./edit-client";

export async function generateStaticParams() {
  return [{ id: "_" }];
}

export default function EditProductPage() {
  return <EditProductClient />;
}
