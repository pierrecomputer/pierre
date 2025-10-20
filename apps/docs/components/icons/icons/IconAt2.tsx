// Generated from svgs/IconAt2.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconAt2 = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M1.5 8c0-1.475.08-2.61.275-3.489.194-.87.49-1.443.891-1.845.402-.4.975-.697 1.845-.89C5.39 1.58 6.525 1.5 8 1.5s2.61.08 3.489.275c.87.194 1.443.49 1.845.891.4.402.697.975.89 1.845.196.879.276 2.014.276 3.489q0 .951-.048 1.73c-.03.465-.33.897-.81 1.128l-.045.022A1.462 1.462 0 0 1 11.5 9.562V5H10a3.75 3.75 0 1 0 .263 5.783 2.96 2.96 0 0 0 3.985 1.448l.046-.022c.907-.437 1.588-1.315 1.655-2.384Q16.002 8.985 16 8c0-1.51-.08-2.774-.311-3.814-.233-1.049-.63-1.915-1.295-2.58S12.863.544 11.814.31C10.774.08 9.51 0 8 0S5.226.08 4.186.311c-1.049.233-1.915.63-2.58 1.295S.544 3.137.31 4.186C.08 5.226 0 6.49 0 8s.08 2.774.311 3.814c.233 1.049.63 1.915 1.295 2.58s1.531 1.062 2.58 1.295C5.226 15.92 6.49 16 8 16c2.297 0 4.066-.181 5.345-.846l-.69-1.331c-.926.48-2.361.677-4.655.677-1.475 0-2.61-.08-3.489-.275-.87-.194-1.443-.49-1.845-.891-.4-.402-.697-.975-.89-1.845C1.58 10.61 1.5 9.475 1.5 8m4 0A2.25 2.25 0 1 1 10 8a2.25 2.25 0 0 1-4.5 0" /></svg>
	);
};

export { IconAt2 as ReactComponent };
