// Generated from svgs/IconPlayCircle.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconPlayCircle = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M11.73 8.55c.36-.305.36-.798 0-1.102-.472-.398-1.309-1.02-2.756-1.893-1.331-.804-2.228-1.247-2.804-1.49-.495-.21-.964.106-1.024.661C5.073 5.396 5 6.452 5 7.998c0 1.553.073 2.612.147 3.281.06.551.524.864 1.016.656.573-.241 1.471-.684 2.811-1.493 1.45-.875 2.286-1.496 2.756-1.893"/><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-1 0A7 7 0 1 0 1 8a7 7 0 0 0 14 0"/></svg>
	);
};

export { IconPlayCircle as ReactComponent };