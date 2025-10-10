// Generated from svgs/IconLink.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconLink = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M5.813 4.53a.75.75 0 0 1 0-1.06L7.89 1.39A4.75 4.75 0 0 1 14.61 8.11l-1.922 1.921a.75.75 0 0 1-1.06-1.06l1.921-1.922a3.25 3.25 0 0 0-4.596-4.596L6.873 4.53a.75.75 0 0 1-1.06 0M2.452 8.952a3.25 3.25 0 1 0 4.596 4.596l1.922-1.921a.75.75 0 1 1 1.06 1.06L8.11 14.61A4.75 4.75 0 0 1 1.39 7.89L3.47 5.813a.75.75 0 0 1 1.06 1.06z" /><path d="M10.53 5.47a.75.75 0 0 1 0 1.06l-4 4a.75.75 0 0 1-1.06-1.06l4-4a.75.75 0 0 1 1.06 0" /></svg>
	);
};

export { IconLink as ReactComponent };
