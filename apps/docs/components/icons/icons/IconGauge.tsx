// Generated from svgs/IconGauge.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconGauge = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M14.704 4.632a1.75 1.75 0 0 1-1.177.945 6.5 6.5 0 0 1-.93 8.02.75.75 0 0 0 1.06 1.06 8 8 0 0 0 1.047-10.025" opacity=".4" /><path fillRule="evenodd" d="M12.596 4.404a6.5 6.5 0 1 0-9.192 9.192.75.75 0 0 1-1.06 1.06A8 8 0 0 1 13.656 3.344a.75.75 0 0 1-1.06 1.06" clipRule="evenodd" /><circle cx="8" cy="9" r="3" /></svg>
	);
};

export { IconGauge as ReactComponent };
