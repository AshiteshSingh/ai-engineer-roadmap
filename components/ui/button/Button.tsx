import * as React from "react";
import { cx } from "../cx";
import styles from "./Button.module.css";

export interface ButtonProps
  extends React.ComponentPropsWithoutRef<"button"> {
  variant?: "primary" | "secondary" | "ghost";
}

const variantClass = {
  primary: styles.primary,
  secondary: styles.secondary,
  ghost: styles.ghost,
} as const;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", type = "button", className, ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cx(styles.btn, variantClass[variant], className)}
      {...rest}
    />
  ),
);
Button.displayName = "Button";
