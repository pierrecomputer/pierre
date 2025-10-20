// Generated from svgs/IconGrid.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconGrid = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path fillRule="evenodd" d="M1.75 0A1.75 1.75 0 0 0 0 1.75v4C0 6.716.784 7.5 1.75 7.5h4A1.75 1.75 0 0 0 7.5 5.75v-4A1.75 1.75 0 0 0 5.75 0zM1.5 1.75a.25.25 0 0 1 .25-.25h4a.25.25 0 0 1 .25.25v4a.25.25 0 0 1-.25.25h-4a.25.25 0 0 1-.25-.25zM1.75 8.5A1.75 1.75 0 0 0 0 10.25v4C0 15.216.784 16 1.75 16h4a1.75 1.75 0 0 0 1.75-1.75v-4A1.75 1.75 0 0 0 5.75 8.5zm-.25 1.75a.25.25 0 0 1 .25-.25h4a.25.25 0 0 1 .25.25v4a.25.25 0 0 1-.25.25h-4a.25.25 0 0 1-.25-.25zM8.5 1.75C8.5.784 9.284 0 10.25 0h4C15.216 0 16 .784 16 1.75v4a1.75 1.75 0 0 1-1.75 1.75h-4A1.75 1.75 0 0 1 8.5 5.75zm1.75-.25a.25.25 0 0 0-.25.25v4c0 .138.112.25.25.25h4a.25.25 0 0 0 .25-.25v-4a.25.25 0 0 0-.25-.25zM10.25 8.5a1.75 1.75 0 0 0-1.75 1.75v4c0 .966.784 1.75 1.75 1.75h4A1.75 1.75 0 0 0 16 14.25v-4a1.75 1.75 0 0 0-1.75-1.75zM10 10.25a.25.25 0 0 1 .25-.25h4a.25.25 0 0 1 .25.25v4a.25.25 0 0 1-.25.25h-4a.25.25 0 0 1-.25-.25z" clipRule="evenodd" /></svg>
	);
};

export { IconGrid as ReactComponent };
