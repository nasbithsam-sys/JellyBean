import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "crm-motion inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-[13px] font-semibold tracking-[-0.01em] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-linear-to-r from-[#50469B] via-[#5a50a8] to-[#6a61b4] text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_16px_30px_-16px_rgba(80,70,155,0.72)] hover:from-[#453c88] hover:via-[#50469B] hover:to-[#6258ab] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_20px_38px_-18px_rgba(80,70,155,0.82)]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 hover:shadow-md",
        outline:
          "border border-input bg-linear-to-b from-white to-[#f1f2ee] text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_10px_24px_-18px_rgba(15,23,42,0.28)] hover:bg-[#ebe8f5] hover:text-[#50469B] hover:border-[#bcb6df]",
        secondary:
          "bg-linear-to-b from-white to-[#e4f2f4] text-[#2c5260] border border-[#b9dde3] shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_10px_24px_-18px_rgba(94,177,191,0.24)] hover:bg-[#d9eef1] hover:text-[#244651] hover:border-[#9ccbd3]",
        ghost: "hover:bg-[#ebe8f5] hover:text-[#50469B]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-[12px]",
        lg: "h-11 rounded-xl px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
