const express = require('express');

const { ApolloServerPluginDrainHttpServer } = require('apollo-server-core');
const { createServer } = require('http');
const { gql } = require('apollo-server');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const { useServer } = require('graphql-ws/lib/use/ws');

const { ApolloServer } = require('apollo-server-express');
const { WebSocketServer } = require('ws');
const { Sequelize } = require('sequelize');

// const { PubSub } = require('graphql-subscriptions');

const PORT = 5000;
const convertStringToDate = (str) => new Date(str).toLocaleString();

const postgresConfig =
	'postgres://jcdqqtwmvpoinf:8698de867831bcab4a2109dcd1328e3f661aa4af81084291d9d567e96ec85516@ec2-44-194-4-127.compute-1.amazonaws.com:5432/d90gu1otds6653';

const sequelize = new Sequelize(postgresConfig, {
	dialectOptions: {
		ssl: {
			require: true,
			rejectUnauthorized: false
		}
	}
});

const typeDefs = gql`
	type Todo {
		id: ID!
		title: String!
		completed: Boolean!
		createdat: String
		updatedat: String
	}

	type TodoSub {
		title: String!
		completed: Boolean!
		createdat: String
		updatedat: String
	}

	input ITodo {
		title: String!
		completed: Boolean!
	}

	input IUpdateTodo {
		id: ID
		completed: Boolean!
		updatedat: String
	}

	type Query {
		todos: [Todo]
		todo(id: ID): Todo
	}

	type Mutation {
		createTodo(todo: ITodo): Boolean
		updateTodo(updateTodo: IUpdateTodo): Boolean
		deleteTodo(id: ID): Boolean
	}

	type Subscription {
		todoLatest: TodoSub!
	}
`;

const TODO_LATEST = 'TODO_LATEST';

const resolvers = {
	Subscription: {
		todoLatest: {
			subscription: (_, __, { pubsub }) => pubsub.asyncIterator(TODO_LATEST)
		}
	},

	Query: {
		todos: async () => {
			const result = await sequelize.query('select * from todos');
			return result[0];
		},

		todo: async (_, { id }) => {
			const result = await sequelize.query(`select * from todos where id=${id}`);
			return result[0][0];
		}
	},

	Mutation: {
		createTodo: async (_, { todo }) =>
			// {pubsub}
			{
				const { title, completed } = todo;
				if (!title || !String(completed)) throw Error('Required title and completed');
				const date = new Date();
				const createdat = date.toLocaleString();
				const updatedat = date.toLocaleString();
				await sequelize.query(
					`insert into todos (title, completed, createdat, updatedat) values ('${title}',${completed},'${createdat}','${updatedat}')`
				);

				const todoLatest = {
					title,
					completed,
					createdat,
					updatedat
				};

				pubsub.publish(TODO_LATEST, {
					todoLatest
				});

				return true;
			},

		updateTodo: async (_, { updateTodo }) => {
			let { id, completed, updatedat } = updateTodo;
			if (!String(id) || !String(completed)) throw Error('Required id and completed');
			updatedat = convertStringToDate(updatedat);
			await sequelize.query(`update todos set completed = ${completed}, updatedat = '${updatedat}' WHERE id = ${id}`);
			return true;
		},

		deleteTodo: async (_, { id }) => {
			if (!String(id)) throw Error('Required id');
			await sequelize.query(`delete from todos WHERE id = ${id}`);
			return true;
		}
	}
};

// const pubsub = new PubSub();

// const server = new ApolloServer({
// 	typeDefs,
// 	resolvers,
// 	context: (req, res) => ({ req, res, pubsub })
// });

// server
// 	.listen(process.env.PORT || PORT, () => {
// 		console.log(`Server running at ${PORT}`);
// 	})
// 	.then(() => {
// 		sequelize
// 			.authenticate()
// 			.then(() => {
// 				console.log('Connection has been established successfully.');
// 			})
// 			.catch((err) => {
// 				console.error('Unable to connect to the database:', err);
// 			});
// 	});

const schema = makeExecutableSchema({ typeDefs, resolvers });

const app = express();
const httpServer = createServer(app);

const wsServer = new WebSocketServer({
	server: httpServer,
	path: '/graphql'
});

const serverCleanup = useServer({ schema }, wsServer);

const server = new ApolloServer({
	schema,
	plugins: [
		// Proper shutdown for the HTTP server.
		ApolloServerPluginDrainHttpServer({ httpServer }),

		// Proper shutdown for the WebSocket server.
		{
			async serverWillStart() {
				return {
					async drainServer() {
						await serverCleanup.dispose();
					}
				};
			}
		}
	]
});

(async () => {
	await server.start();
	server.applyMiddleware({ app });
})();

httpServer.listen(PORT, () => {
	console.log(`Server is now running on http://localhost:${PORT}${server.graphqlPath}`);
	sequelize
		.authenticate()
		.then(() => {
			console.log('Connection has been established successfully.');
		})
		.catch((err) => {
			console.error('Unable to connect to the database:', err);
		});
});
