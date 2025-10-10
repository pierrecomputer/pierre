// Generated from svgs/IconSearch.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconSearch = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path fillRule="evenodd" d="M10.775 12.896a7 7 0 1 1 2.121-2.121l2.665 2.664a1.5 1.5 0 0 1-2.122 2.122zM7 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11" clipRule="evenodd" /></svg>
	);
};

export { IconSearch as ReactComponent };
