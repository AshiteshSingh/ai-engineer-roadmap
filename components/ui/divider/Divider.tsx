import * as React from "react";
import { cx } from "../cx";
import styles from "./Divider.module.css";

export type DividerProps = React.ComponentPropsWithoutRef<"hr">;

export const Divider = React.forwardRef<HTMLHRElement, DividerProps>(
  ({ className, ...rest }, ref) => (
    <hr ref={ref} className={cx(styles.divider, className)} {...rest} />
  ),
);
Divider.displayName = "Divider";
