// Generated from svgs/IconNoNewLine.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconNoNewLine = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1.125);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M5.22 4.97a.75.75 0 1 1 1.06 1.06L4.31 8l1.97 1.97a.75.75 0 0 1-1.06 1.06L3.25 9.06l-1.97 1.97A.75.75 0 0 1 .22 9.97L2.19 8 .22 6.03a.75.75 0 1 1 1.06-1.06l1.97 1.97zm12.03-3.22a.75.75 0 0 1 .75.75V5a3.75 3.75 0 0 1-3.75 3.75h-3.69l1.22 1.22.052.056a.75.75 0 0 1-1.056 1.056l-.056-.052-2.5-2.5a.75.75 0 0 1 0-1.06l2.5-2.5a.75.75 0 0 1 1.06 1.06l-1.22 1.22h3.69A2.25 2.25 0 0 0 16.5 5V2.5a.75.75 0 0 1 .75-.75"/></svg>
	);
};

export { IconNoNewLine as ReactComponent };