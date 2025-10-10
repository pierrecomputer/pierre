// Generated from svgs/IconStar.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconStar = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M9.11.673c-.451-.897-1.769-.897-2.22 0L5.105 4.228l-4.043.577c-.94.135-1.461 1.299-.687 2.04L3.31 9.66l-.688 3.94c-.09.52.17.96.525 1.193a1.26 1.26 0 0 0 1.273.066L8 13.008l3.579 1.85a1.26 1.26 0 0 0 1.273-.066 1.18 1.18 0 0 0 .524-1.193l-.687-3.94 2.936-2.814c.774-.741.252-1.905-.687-2.04l-4.043-.577zM6.38 5.024 8 1.799l1.62 3.225c.184.368.54.605.929.66l3.592.514-2.607 2.498c-.28.268-.42.66-.35 1.054l.618 3.544-3.222-1.665a1.27 1.27 0 0 0-1.16 0l-3.222 1.665.618-3.544a1.18 1.18 0 0 0-.35-1.054L1.86 6.198l3.592-.513c.389-.056.745-.293.93-.661" /></svg>
	);
};

export { IconStar as ReactComponent };
