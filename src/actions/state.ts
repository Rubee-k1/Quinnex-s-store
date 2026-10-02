export type FormState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Echo of submitted values so a form can be re-populated after an error. */
  values?: Record<string, string | undefined>;
};

export const initialFormState: FormState = { status: "idle" };
