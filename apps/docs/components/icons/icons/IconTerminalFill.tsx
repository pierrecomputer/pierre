// Generated from svgs/IconTerminalFill.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconTerminalFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M0 8c0-6.588 1.412-8 8-8s8 1.412 8 8-1.412 8-8 8-8-1.412-8-8m4.53-3.78a.75.75 0 0 0-1.06 1.06L5.19 7 3.47 8.72a.75.75 0 0 0 1.06 1.06l2.25-2.25a.75.75 0 0 0 0-1.06zM7.75 8.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5z" /></svg>
	);
};

export { IconTerminalFill as ReactComponent };
