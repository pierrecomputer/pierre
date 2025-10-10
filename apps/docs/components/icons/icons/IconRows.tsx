// Generated from svgs/IconRows.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconRows = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path fillRule="evenodd" d="M1.75 0A1.75 1.75 0 0 0 0 1.75v4C0 6.716.784 7.5 1.75 7.5h12.5A1.75 1.75 0 0 0 16 5.75v-4A1.75 1.75 0 0 0 14.25 0zM1.5 1.75a.25.25 0 0 1 .25-.25h12.5a.25.25 0 0 1 .25.25v4a.25.25 0 0 1-.25.25H1.75a.25.25 0 0 1-.25-.25zM1.75 8.5A1.75 1.75 0 0 0 0 10.25v4C0 15.216.784 16 1.75 16h12.5A1.75 1.75 0 0 0 16 14.25v-4a1.75 1.75 0 0 0-1.75-1.75zm-.25 1.75a.25.25 0 0 1 .25-.25h12.5a.25.25 0 0 1 .25.25v4a.25.25 0 0 1-.25.25H1.75a.25.25 0 0 1-.25-.25z" clipRule="evenodd" /></svg>
	);
};

export { IconRows as ReactComponent };
