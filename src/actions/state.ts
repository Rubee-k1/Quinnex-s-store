export type FormState = {
  status: "idle" | "error" | "success";
  message?: string;
};

export const initialFormState: FormState = { status: "idle" };
