// Generated from svgs/IconDragonball.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconDragonball = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="m6.736 6.19 1.021-2.045c.097-.193.39-.193.486 0L9.264 6.19c.038.076.114.129.202.142l2.306.33c.216.032.304.279.152.426l-1.686 1.623a.24.24 0 0 0-.072.216l.395 2.279c.036.207-.198.363-.394.261L8.13 10.409a.28.28 0 0 0-.26 0l-2.037 1.059c-.196.102-.43-.053-.394-.261l.395-2.279a.24.24 0 0 0-.072-.216L4.076 7.089c-.152-.147-.064-.394.152-.425l2.306-.331a.27.27 0 0 0 .202-.142" /><path fillRule="evenodd" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0M1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0" clipRule="evenodd" /></svg>
	);
};

export { IconDragonball as ReactComponent };
