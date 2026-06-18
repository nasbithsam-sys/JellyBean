export function friendlyError(error: unknown): string {
  if (!error) return "An unknown error occurred.";

  let message = "";
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "object" && error !== null && "message" in error) {
    message = String((error as Record<string, unknown>).message);
  } else if (typeof error === "string") {
    message = error;
  } else {
    message = String(error);
  }

  const messageLower = message.toLowerCase();

  // Pattern checks for technical errors
  if (messageLower.includes("duplicate key value violates unique constraint")) {
    return "This record already exists.";
  }
  if (messageLower.includes("violates foreign key constraint")) {
    return "This item is linked to other data and cannot be removed.";
  }
  if (messageLower.includes("new row violates row-level security")) {
    return "You don't have permission to do that.";
  }
  if (messageLower.includes("jwt expired")) {
    return "Your session has expired. Please sign in again.";
  }
  if (messageLower.includes("invalid login credentials")) {
    return "Incorrect email or password.";
  }
  if (messageLower.includes("email not confirmed")) {
    return "Please verify your email address before signing in.";
  }
  if (messageLower.includes("user not found")) {
    return "No account found with those details.";
  }
  if (messageLower.includes("bootstrap is closed; users already exist")) {
    return "Setup is already complete. Use the Settings page to manage users.";
  }
  if (messageLower.includes("missing openai_api_key")) {
    return "AI classification is not configured. Contact your administrator.";
  }
  if (messageLower.includes("no rows found")) {
    return "The requested data could not be found.";
  }
  if (messageLower.includes("timeout")) {
    return "The request timed out. Please try again.";
  }

  return message;
}
