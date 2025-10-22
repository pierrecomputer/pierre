// Generated from svgs/IconCodeSearch.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconCodeSearch = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M5.22 4.47a.75.75 0 0 1 1.06 1.06L4.81 7l1.47 1.47a.75.75 0 0 1-1.06 1.06l-2-2a.75.75 0 0 1 0-1.06zm2.5 1.06a.75.75 0 0 1 1.06-1.06l2 2a.75.75 0 0 1 0 1.06l-2 2a.75.75 0 0 1-1.06-1.06L9.19 7z"/><path d="M10.432 13.102a7 7 0 1 1 2.464-2.328l2.665 2.665a1.5 1.5 0 0 1-2.122 2.122l-2.664-2.665q-.168.107-.343.206M12.5 7a5.5 5.5 0 1 0-11 0 5.5 5.5 0 0 0 11 0" clip-rule="evenodd"/></svg>
	);
};

export { IconCodeSearch as ReactComponent };