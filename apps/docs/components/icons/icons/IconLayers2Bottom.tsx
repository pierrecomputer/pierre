// Generated from svgs/IconLayers2Bottom.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconLayers2Bottom = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M7.553 2.224a1 1 0 0 1 .894 0l6.658 3.329a.5.5 0 0 1 0 .894l-6.658 3.33-.107.045a1 1 0 0 1-.68 0l-.107-.046L.894 6.447a.5.5 0 0 1 0-.894zM3.354 6 8 8.322 12.645 6 8 3.677z" clip-rule="evenodd" opacity=".4"/><path d="M15.105 9.554a.5.5 0 0 1 0 .894l-6.658 3.33c-.281.14-.613.14-.894 0l-6.659-3.33a.5.5 0 0 1 0-.894l1.989-.994 4.222 2.11a2 2 0 0 0 1.79 0l4.222-2.11z"/></svg>
	);
};

export { IconLayers2Bottom as ReactComponent };