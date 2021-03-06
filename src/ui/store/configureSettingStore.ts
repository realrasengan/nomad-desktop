import {createStore, applyMiddleware, combineReducers} from "redux";
import thunk from "redux-thunk";
import { createLogger } from "redux-logger";
import posts, {PostsActionType} from "../../../external/universal/ducks/posts";
import app, {AppActionType} from "../ducks/app";
import blocklist from "../ducks/blocklist";
import users from "../../../external/universal/ducks/users";

const rootReducer = combineReducers({
  app,
  blocklist,
  users,
  posts,
});

export type NewSettingState = ReturnType<typeof rootReducer>;

export default function configureSettingStore() {
  return createStore(
    rootReducer,
    process.env.NODE_ENV === 'development'
      ? applyMiddleware(thunk, createLogger({
        collapsed: (getState, action = {}) => [
          PostsActionType.UPDATE_COMMENTS,
          PostsActionType.UPDATE_POST,
          PostsActionType.APPEND_NEW_POST,
          PostsActionType.APPEND_NEW_COMMENT,
          AppActionType.UPDATE_FOOTER,
        ].includes(action.type),
      }))
      : applyMiddleware(thunk),
  );
}
