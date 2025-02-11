import {
  get_dependency_names,
  prepare_dependency_names,
} from "../../utils/utils";

const dependency_path =
  "/Users/samuelkekkonen/Offline Documents/business-projects/production/stackguide/project-setup-ai";

console.log(await get_dependency_names(dependency_path));
console.log(
  await prepare_dependency_names(get_dependency_names(dependency_path))
);
