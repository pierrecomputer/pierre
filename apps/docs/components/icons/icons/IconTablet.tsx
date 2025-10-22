// Generated from svgs/IconTablet.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconTablet = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M6 12a.5.5 0 0 0-.5.5v.5a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5v-.5a.5.5 0 0 0-.5-.5z"/><path d="M3.25 0A2.25 2.25 0 0 0 1 2.25v11.5A2.25 2.25 0 0 0 3.25 16h9.5A2.25 2.25 0 0 0 15 13.75V2.25A2.25 2.25 0 0 0 12.75 0zM2.5 2.25a.75.75 0 0 1 .75-.75h9.5a.75.75 0 0 1 .75.75v11.5a.75.75 0 0 1-.75.75h-9.5a.75.75 0 0 1-.75-.75z" clip-rule="evenodd"/></svg>
	);
};

export { IconTablet as ReactComponent };