// Generated from svgs/IconCiFailedFill.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconCiFailedFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0M6.03 4.97 8 6.94l1.97-1.97a.75.75 0 1 1 1.06 1.06L9.06 8l1.97 1.97a.75.75 0 1 1-1.06 1.06L8 9.06l-1.97 1.97a.75.75 0 1 1-1.06-1.06L6.94 8 4.97 6.03a.75.75 0 0 1 1.06-1.06"/></svg>
	);
};

export { IconCiFailedFill as ReactComponent };