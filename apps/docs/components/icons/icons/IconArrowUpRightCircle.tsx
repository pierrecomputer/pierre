// Generated from svgs/IconArrowUpRightCircle.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconArrowUpRightCircle = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M9 1.75A.75.75 0 0 1 9.75 1h4.5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0V3.56L8.53 8.53a.75.75 0 0 1-1.06-1.06l4.97-4.97H9.75A.75.75 0 0 1 9 1.75" /><path d="M7.25 4.5a4.5 4.5 0 1 0 4.5 4.5.75.75 0 0 1 1.5 0 6 6 0 1 1-6-6 .75.75 0 0 1 0 1.5" /></svg>
	);
};

export { IconArrowUpRightCircle as ReactComponent };
