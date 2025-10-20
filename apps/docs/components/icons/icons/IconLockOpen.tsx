// Generated from svgs/IconLockOpen.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconLockOpen = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M9.5 4a2.5 2.5 0 0 1 5 0v2.167H16V4a4 4 0 0 0-8 0v1.021Q7.535 5 7 5H5c-4.117 0-5 .883-5 5v1c0 4.118.883 5 5 5h2c4.118 0 5-.883 5-5v-1c0-3.098-.5-4.364-2.5-4.802zm-8 6c0-.995.055-1.692.167-2.193.107-.483.246-.686.35-.79s.307-.243.79-.35C3.307 6.555 4.005 6.5 5 6.5h2c.995 0 1.692.055 2.193.167.483.107.686.246.79.35s.243.307.35.79c.112.5.167 1.198.167 2.193v1c0 .995-.055 1.692-.166 2.193-.108.483-.247.686-.35.79-.105.104-.308.243-.791.35-.5.112-1.198.167-2.193.167H5c-.995 0-1.692-.055-2.193-.166-.483-.108-.686-.247-.79-.35-.104-.105-.243-.308-.35-.791-.112-.5-.167-1.198-.167-2.193z" /></svg>
	);
};

export { IconLockOpen as ReactComponent };
