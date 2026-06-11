import { useEffect, useState } from "react";
import { subscribeToTags } from "../services/tags";
import type { Tag } from "../types";

export interface UseTagsResult {
  tags: Tag[];
  loading: boolean;
  error: Error | null;
}

export function useTags(): UseTagsResult {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsub = subscribeToTags(
      (data) => {
        setTags(data);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  return { tags, loading, error };
}
