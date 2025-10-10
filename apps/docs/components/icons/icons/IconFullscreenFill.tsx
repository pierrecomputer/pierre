// Generated from svgs/IconFullscreenFill.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconFullscreenFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1.125);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path fillRule="evenodd" d="M15.25 0A2.75 2.75 0 0 1 18 2.75v10.5A2.75 2.75 0 0 1 15.25 16H2.75A2.75 2.75 0 0 1 0 13.25V2.75A2.75 2.75 0 0 1 2.75 0zM8.03 7.97a.75.75 0 0 0-1.06 0L4.5 10.44V8.75a.75.75 0 0 0-1.5 0v3.5c0 .414.336.75.75.75h3.5a.75.75 0 0 0 0-1.5H5.56l2.47-2.47a.75.75 0 0 0 0-1.06M10.75 3a.75.75 0 0 0 0 1.5h1.69L9.97 6.97a.75.75 0 1 0 1.06 1.06l2.47-2.47v1.69a.75.75 0 0 0 1.5 0v-3.5a.75.75 0 0 0-.75-.75z" clipRule="evenodd" /></svg>
	);
};

export { IconFullscreenFill as ReactComponent };
