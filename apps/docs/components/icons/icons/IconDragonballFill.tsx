// Generated from svgs/IconDragonballFill.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconDragonballFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path fillRule="evenodd" d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m7.757-3.855L6.736 6.19a.27.27 0 0 1-.202.142l-2.306.33c-.216.032-.304.279-.152.426l1.686 1.623c.06.057.086.137.072.216l-.395 2.279c-.036.207.198.363.394.261l2.037-1.059a.28.28 0 0 1 .26 0l2.037 1.059c.196.102.43-.053.394-.261l-.395-2.279a.24.24 0 0 1 .072-.216l1.686-1.623c.152-.147.064-.394-.152-.425l-2.306-.331a.27.27 0 0 1-.202-.142L8.243 4.145c-.097-.193-.39-.193-.486 0" clipRule="evenodd" /></svg>
	);
};

export { IconDragonballFill as ReactComponent };
