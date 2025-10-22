// Generated from svgs/IconAsterisk.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconAsterisk = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M2.035 11.669a.75.75 0 0 0 1.07.246l3.898-2.638a.25.25 0 0 1 .39.225l-.336 4.695a.75.75 0 0 0 .748.803h.39a.75.75 0 0 0 .748-.803l-.336-4.695a.25.25 0 0 1 .39-.225l3.898 2.638a.75.75 0 0 0 1.07-.246l.194-.338a.75.75 0 0 0-.321-1.049L9.604 8.225a.25.25 0 0 1 0-.45l4.234-2.057a.75.75 0 0 0 .321-1.05l-.194-.336a.75.75 0 0 0-1.07-.247L8.997 6.723a.25.25 0 0 1-.39-.225l.336-4.695A.75.75 0 0 0 8.195 1h-.39a.75.75 0 0 0-.748.803l.336 4.695a.25.25 0 0 1-.39.225L3.105 4.085a.75.75 0 0 0-1.07.247l-.194.336a.75.75 0 0 0 .321 1.05l4.234 2.057a.25.25 0 0 1 0 .45l-4.234 2.057a.75.75 0 0 0-.321 1.05z"/></svg>
	);
};

export { IconAsterisk as ReactComponent };