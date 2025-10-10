// Generated from svgs/IconChevronFlat.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconChevronFlat = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 0.5);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M1.584 1.376a.75.75 0 0 1 .994.146l.046.062 4 6a.75.75 0 0 1 0 .832l-4 6a.75.75 0 1 1-1.248-.832L5.099 8 1.376 2.416l-.04-.066a.75.75 0 0 1 .248-.974" /></svg>
	);
};

export { IconChevronFlat as ReactComponent };
